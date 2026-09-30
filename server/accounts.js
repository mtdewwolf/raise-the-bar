'use strict';
const crypto = require('node:crypto');
const {promisify} = require('node:util');
const scrypt = promisify(crypto.scrypt);
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const secret = () => crypto.randomBytes(32).toString('hex');
const SCRYPT = {N:32768,r:8,p:1,maxmem:64*1024*1024};
async function passwordHash(password,salt=crypto.randomBytes(16).toString('hex')) {
  return salt+':'+(await scrypt(password,salt,32,SCRYPT)).toString('hex');
}
async function passwordMatches(password,hash) {
  const [salt,expected]=hash.split(':');
  const actual=(await passwordHash(password,salt)).split(':')[1];
  return crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex'));
}
function accounts({db,q,now,limit,HttpError,readJson,auth,profile}) {
  db.exec(`CREATE TABLE IF NOT EXISTS accounts (
    player_id INTEGER PRIMARY KEY REFERENCES players(id), username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL, recovery_confirmed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_sessions (
    token_hash TEXT PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES accounts(player_id), expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS account_sessions_player ON account_sessions(player_id);`);
  const byUser=db.prepare('SELECT * FROM accounts WHERE username = ?');
  const byPlayer=db.prepare('SELECT * FROM accounts WHERE player_id = ?');
  const dummyHash='00000000000000000000000000000000:'+ '00'.repeat(32);
  const username=raw=>typeof raw==='string'?raw.trim().toLowerCase():'';
  function validatePassword(value) {
    if(typeof value!=='string'||value.length<12||value.length>128) throw new HttpError(400,'Use a password of 12–128 characters');
    return value;
  }
  const suppliedPassword=body=>typeof body.password==='string'&&body.password.length<=128?body.password:'';
  function throttle(ip,user) {limit('account-ip:'+ip,12,3600000);limit('account-user:'+digest(user),8,3600000);}
  function issue(playerId) {
    const token=secret();
    db.prepare('INSERT INTO account_sessions VALUES (?,?,?)').run(digest(token),playerId,now()+24*3600000);
    db.prepare('DELETE FROM account_sessions WHERE expires_at <= ?').run(now());return token;
  }
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {const value=fn();db.exec('COMMIT');return value;} catch(e){db.exec('ROLLBACK');throw e;}
  }
  const info=id=>{const row=byPlayer.get(id);return row?{username:row.username,recoveryConfirmed:!!row.recovery_confirmed}:null;};
  const resolve=token=>{const row=db.prepare('SELECT player_id FROM account_sessions WHERE token_hash = ? AND expires_at > ?').get(digest(token),now());return row?q.playerById.get(row.player_id):null;};
  const routes={
    'POST /api/account/register':async(req,ip)=>{
      const p=auth(req,true),body=await readJson(req),user=username(body.username);throttle(ip,user);
      if(byPlayer.get(p.id)) throw new HttpError(409,'This profile already has an account');
      if(body.confirmLink!==true) throw new HttpError(400,'Confirm linking this existing profile');
      if(!/^[a-z0-9_]{3,32}$/.test(user)) throw new HttpError(400,'Username must be 3–32 letters, numbers or underscores');
      const hash=await passwordHash(validatePassword(body.password)),recoveryCode=secret();
      const token=transaction(()=>{
        auth(req,true);
        if(byUser.get(user)||byPlayer.get(p.id)) throw new HttpError(409,'Account could not be created with those details');
        db.prepare('INSERT INTO accounts VALUES (?,?,?,?,0,?)').run(p.id,user,hash,digest(recoveryCode),now());
        // Invalidate legacy bearer sync code; it cannot remain an account back door.
        db.prepare('UPDATE players SET token_hash = ? WHERE id = ?').run(digest(secret()),p.id);
        return issue(p.id);
      });
      return {...profile(q.playerById.get(p.id),token),recoveryCode};
    },
    'POST /api/account/login':async(req,ip)=>{
      const body=await readJson(req),user=username(body.username);throttle(ip,user);
      const row=byUser.get(user),valid=await passwordMatches(suppliedPassword(body),row?row.password_hash:dummyHash);
      const token=transaction(()=>{
        if(!row||!valid||byUser.get(user)?.password_hash!==row.password_hash) throw new HttpError(401,'Invalid account credentials');
        return issue(row.player_id);
      });return profile(q.playerById.get(row.player_id),token);
    },
    'POST /api/account/rotate-recovery':async(req,ip)=>{
      const p=auth(req,true),body=await readJson(req);throttle(ip,'rotate:'+p.id);
      const row=byPlayer.get(p.id),valid=await passwordMatches(suppliedPassword(body),row?row.password_hash:dummyHash),recoveryCode=secret();
      const token=transaction(()=>{
        if(!row||!valid||byPlayer.get(p.id)?.password_hash!==row.password_hash) throw new HttpError(401,'Invalid account credentials');
        if(auth(req,true).id!==p.id) throw new HttpError(401,'Invalid account credentials');
        db.prepare('UPDATE accounts SET recovery_hash = ?, recovery_confirmed = 0 WHERE player_id = ?').run(digest(recoveryCode),p.id);
        db.prepare('DELETE FROM account_sessions WHERE player_id = ?').run(p.id);return issue(p.id);
      });return {...profile(q.playerById.get(p.id),token),recoveryCode};
    },
    'POST /api/account/recover':async(req,ip)=>{
      const body=await readJson(req),user=username(body.username);throttle(ip,user);
      const newHash=await passwordHash(validatePassword(body.password)),recoveryHash=digest(body.recoveryCode||''),recoveryCode=secret();
      const result=transaction(()=>{
        const row=byUser.get(user),expected=row?row.recovery_hash:digest('invalid');
        if(!crypto.timingSafeEqual(Buffer.from(recoveryHash,'hex'),Buffer.from(expected,'hex'))||!row) throw new HttpError(401,'Invalid account credentials');
        db.prepare('UPDATE accounts SET password_hash = ?, recovery_hash = ?, recovery_confirmed = 0 WHERE player_id = ?').run(newHash,digest(recoveryCode),row.player_id);
        db.prepare('DELETE FROM account_sessions WHERE player_id = ?').run(row.player_id);
        return {id:row.player_id,token:issue(row.player_id)};
      });return {...profile(q.playerById.get(result.id),result.token),recoveryCode};
    },
    'POST /api/account/confirm-recovery':async(req,ip)=>{
      const body=await readJson(req),p=auth(req,true);throttle(ip,'confirm:'+p.id);const row=byPlayer.get(p.id);
      if(!row||!crypto.timingSafeEqual(Buffer.from(digest(body.recoveryCode||''),'hex'),Buffer.from(row.recovery_hash,'hex'))) throw new HttpError(401,'Invalid account credentials');
      db.prepare('UPDATE accounts SET recovery_confirmed = 1 WHERE player_id = ?').run(p.id);return profile(q.playerById.get(p.id));
    },
    'POST /api/account/logout':req=>{const p=auth(req,true);db.prepare('DELETE FROM account_sessions WHERE player_id = ?').run(p.id);return {ok:true};},
  };
  return {routes,resolve,info,transaction};
}
module.exports={accounts};
