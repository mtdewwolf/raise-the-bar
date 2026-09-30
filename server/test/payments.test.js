'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Stripe=require('stripe');
const {createApp}=require('../server'),{openDb}=require('../db');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const SECRET='whsec_offline_fixture_only',PASSWORD='correct horse fixture battery';
function provider(){
 const sdk=new Stripe('sk_test_offline_fixture_only'),sessions=new Map(),intents=new Map(),charges=new Map(),keys=new Map();let seq=0;
 const stripe={webhooks:sdk.webhooks,checkout:{sessions:{
  create:async(params,{idempotencyKey})=>{
   if(keys.has(idempotencyKey))return sessions.get(keys.get(idempotencyKey));
   const id='cs_test_'+(++seq),pi='pi_'+seq,ch='ch_'+seq,product=params.line_items[0].price_data;
   const charge={id:ch,livemode:false,paid:false,refunded:false,amount_refunded:0,disputed:false,amount:product.unit_amount,currency:product.currency,payment_intent:pi};
   const intent={id:pi,livemode:false,status:'requires_payment_method',amount:product.unit_amount,currency:product.currency,metadata:params.payment_intent_data.metadata,latest_charge:charge};
   const session={id,status:'open',livemode:false,mode:params.mode,metadata:params.metadata,client_reference_id:params.client_reference_id,amount_total:product.unit_amount,currency:product.currency,payment_status:'unpaid',payment_intent:intent,line_items:{data:[{quantity:1,amount_total:product.unit_amount,price:{product:{metadata:product.product_data.metadata}}}]},url:'https://checkout.stripe.com/c/pay/'+id};
   sessions.set(id,session);intents.set(pi,intent);charges.set(ch,charge);keys.set(idempotencyKey,id);return session;
  },retrieve:async id=>{assert.ok(sessions.has(id));return sessions.get(id);}}},paymentIntents:{retrieve:async id=>intents.get(id)},charges:{retrieve:async id=>charges.get(id)}};
 return {stripe,sessions,pay:s=>{s.payment_status='paid';s.status='complete';s.payment_intent.status='succeeded';s.payment_intent.latest_charge.paid=true;}};
}
async function withApp(fn,{dbFile=':memory:',mock=true}={}){
 let time=Date.UTC(2026,8,30,9);const fake=provider();
 const app=createApp({dbFile,now:()=>time,publicUrl:'https://fixture.invalid',pool:{close:async()=>{}},payments:mock?{stripe:fake.stripe,webhookSecret:SECRET}:undefined});
 await new Promise(r=>app.listen(0,r));const base='http://127.0.0.1:'+app.address().port;
 async function call(method,url,body,token,headers={}){
  const res=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:res.status,body:await res.json()};
 }
 async function webhook(object,type='checkout.session.completed',id='evt_'+Math.random(),extra={}){
  const event={id,type,livemode:false,data:{object},...extra},payload=JSON.stringify(event);
  const signature=fake.stripe.webhooks.generateTestHeaderString({payload,secret:SECRET,timestamp:Math.floor(time/1000)});
  return call('POST','/api/payments/stripe/webhook',event,undefined,{'stripe-signature':signature});
 }
 async function register(user='fixture',legacy){legacy||=(await call('POST','/api/player',{})).body;const r=await call('POST','/api/account/register',{username:user,password:PASSWORD,confirmLink:true},legacy.token);assert.equal(r.status,200,JSON.stringify(r.body));return {legacy,...r.body};}
 async function confirmed(user='fixture'){const p=await register(user);assert.equal((await call('POST','/api/account/confirm-recovery',{recoveryCode:p.recoveryCode},p.token)).status,200);return p;}
 const buy=token=>call('POST','/api/shop/checkout',{sku:'supporter_pack',channel:'web'},token);
 try{await fn({call,webhook,register,confirmed,buy,fake,base,advance:ms=>time+=ms});}finally{await app.closeAll();}
}
async function onDisk(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rtb-payment-')),dbFile=path.join(dir,'state.sqlite');try{await fn(dbFile);}finally{fs.rmSync(dir,{recursive:true,force:true});}}

test('recoverable account preserves player/earned rewards and revokes legacy token',()=>withApp(async({call,register})=>{
 const legacy=(await call('POST','/api/player',{})).body;await call('PUT','/api/me/achievements',{ids:['first_hop','h10']},legacy.token);
 const p=await register('owner',legacy);assert.equal(p.playerId,legacy.playerId);assert.ok(p.inventory.some(i=>i.id==='cap'));
 assert.equal((await call('GET','/api/me',undefined,legacy.token)).status,401);
 assert.equal((await call('POST','/api/account/register',{username:'other',password:PASSWORD,confirmLink:true},p.token)).status,409);
 const login=await call('POST','/api/account/login',{username:'owner',password:PASSWORD});assert.equal(login.status,200);
 const recovered=await call('POST','/api/account/recover',{username:'owner',password:PASSWORD+'new',recoveryCode:p.recoveryCode});assert.equal(recovered.status,200);assert.equal(recovered.body.playerId,p.playerId);
 assert.equal((await call('GET','/api/me',undefined,p.token)).status,401);assert.equal((await call('GET','/api/me',undefined,login.body.token)).status,401);
 assert.equal((await call('POST','/api/account/recover',{username:'owner',password:PASSWORD,recoveryCode:p.recoveryCode})).status,401);assert.equal(recovered.body.account.recoveryConfirmed,false);
}));
test('link consent, generic credential failures, cross-profile recovery, expiry and logout',()=>withApp(async({call,register,advance})=>{
 const guest=(await call('POST','/api/player',{})).body;assert.equal((await call('POST','/api/account/register',{username:'other',password:PASSWORD},guest.token)).status,400);
 const a=await register('alice'),b=await register('bob');
 assert.equal((await call('POST','/api/account/recover',{username:'bob',password:PASSWORD,recoveryCode:a.recoveryCode})).status,401);
 assert.equal((await call('POST','/api/account/login',{username:'alice',password:'wrong'})).body.error,(await call('POST','/api/account/login',{username:'missing',password:'wrong'})).body.error);
 assert.equal((await call('POST','/api/account/logout',{},a.token)).status,200);assert.equal((await call('GET','/api/me',undefined,a.token)).status,401);
 advance(24*3600000+1);assert.equal((await call('GET','/api/me',undefined,b.token)).status,401);
}));
test('forged paid achievement, unowned equip, client prices and native checkout denied',()=>withApp(async({call,confirmed})=>{
 const p=await confirmed();const ach=await call('PUT','/api/me/achievements',{ids:['supporter','supporter_pack','first_hop','admin']},p.token);assert.deepEqual(ach.body.achievements,['first_hop']);
 assert.equal((await call('PATCH','/api/me',{look:{band:'supporter'}},p.token)).status,403);assert.equal((await call('PATCH','/api/me',{look:{band:'pink'}},p.token)).status,200);assert.equal((await call('PATCH','/api/me',{look:{suit:'unknown'}},p.token)).status,403);
 assert.equal((await call('POST','/api/shop/checkout',{sku:'supporter_pack',channel:'android'},p.token)).status,403);
 assert.equal((await call('POST','/api/shop/checkout',{sku:'supporter_pack',channel:'web',amount:1},p.token)).status,400);
 assert.equal((await call('POST','/api/shop/checkout',{sku:'physics',channel:'web'},p.token)).status,400);
}));
test('unconfirmed recovery, browser success and forged webhook cannot unlock',()=>withApp(async({call,register,buy,fake})=>{
 const p=await register();assert.equal((await buy(p.token)).status,403);
 assert.equal((await call('POST','/api/payments/stripe/webhook',{id:'forged',type:'checkout.session.completed',livemode:false})).status,400);
 assert.ok(!(await call('GET','/api/me?checkout=return',undefined,p.token)).body.inventory.some(i=>i.id==='supporter'));assert.equal(fake.sessions.size,0);
}));
test('checkout and webhook duplicates fulfill once, restore isolated, refunds terminal',()=>withApp(async({call,confirmed,buy,fake,webhook})=>{
 const p=await confirmed(),other=await confirmed('other');const both=await Promise.all([buy(p.token),buy(p.token)]);assert.equal(both[0].body.url,both[1].body.url);assert.equal(fake.sessions.size,1);
 const s=[...fake.sessions.values()][0];assert.equal((await webhook(s)).status,200);assert.ok(!(await call('GET','/api/me',undefined,p.token)).body.inventory.some(i=>i.id==='supporter'));
 fake.pay(s);const events=await Promise.all([webhook(s,'checkout.session.completed','evt_same'),webhook(s,'checkout.session.completed','evt_same')]);assert.ok(events.every(r=>r.status===200));await webhook(s,'checkout.session.async_payment_succeeded');
 let me=(await call('GET','/api/me',undefined,p.token)).body;assert.equal(me.inventory.filter(i=>i.id==='supporter').length,1);assert.equal(me.purchases.length,1);assert.equal((await call('PATCH','/api/me',{look:{band:'supporter'}},p.token)).status,200);
 assert.ok(!(await call('POST','/api/shop/restore',{},other.token)).body.inventory.some(i=>i.id==='supporter'));assert.equal((await buy(p.token)).status,409);
 const charge=s.payment_intent.latest_charge;charge.refunded=true;charge.amount_refunded=499;assert.equal((await webhook(charge,'charge.refunded')).status,200);
 charge.refunded=false;charge.amount_refunded=0;await webhook(s);me=(await call('POST','/api/shop/restore',{},p.token)).body;assert.equal(me.purchases[0].status,'revoked');assert.equal(me.look.band,'yellow');assert.ok(!me.inventory.some(i=>i.id==='supporter'));
}));
test('amount/SKU/live mismatch denied and dispute before fulfillment stays terminal',()=>withApp(async({call,confirmed,buy,fake,webhook})=>{
 const p=await confirmed();await buy(p.token);const s=[...fake.sessions.values()][0];fake.pay(s);
 s.amount_total=1;assert.equal((await webhook(s)).status,422);s.amount_total=499;s.line_items.data[0].price.product.metadata.sku='forged';assert.equal((await webhook(s)).status,422);s.line_items.data[0].price.product.metadata.sku='supporter_pack';
 assert.equal((await webhook(s,undefined,undefined,{livemode:true})).status,400);s.payment_intent.latest_charge.disputed=true;await webhook({payment_intent:s.payment_intent.id},'charge.dispute.created');s.payment_intent.latest_charge.disputed=false;await webhook(s);assert.equal((await call('GET','/api/me',undefined,p.token)).body.purchases[0].status,'revoked');
}));
test('old/future webhook timestamp denied',()=>withApp(async({call,fake})=>{
 const event={id:'evt_time',livemode:false,type:'ignored',data:{object:{}}},payload=JSON.stringify(event);
 for(const timestamp of[1,Date.UTC(2030,0,1)/1000]){const signature=fake.stripe.webhooks.generateTestHeaderString({payload,secret:SECRET,timestamp});assert.equal((await call('POST','/api/payments/stripe/webhook',event,undefined,{'stripe-signature':signature})).status,400);}
}));
test('default app never enables provider checkout',()=>withApp(async({call,confirmed,buy})=>{const p=await confirmed();assert.equal((await call('GET','/api/shop')).body.checkoutEnabled,false);assert.equal((await buy(p.token)).status,503);},{mock:false}));
test('account and owned inventory persist after SQLite restart',()=>onDisk(async dbFile=>{
 let token;await withApp(async({confirmed,buy,fake,webhook})=>{const p=await confirmed();token=p.token;await buy(token);const s=[...fake.sessions.values()][0];fake.pay(s);await webhook(s);},{dbFile});
 await withApp(async({call})=>{const p=(await call('GET','/api/me',undefined,token)).body;assert.equal(p.account.username,'fixture');assert.ok(p.inventory.some(i=>i.id==='supporter'));},{dbFile});
}));
test('lost recovery code can be replaced only after password proof and old sessions revoke',()=>withApp(async({call,register})=>{
 const p=await register();assert.equal((await call('POST','/api/account/rotate-recovery',{password:'wrong'},p.token)).status,401);
 const r=await call('POST','/api/account/rotate-recovery',{password:PASSWORD},p.token);assert.equal(r.status,200);assert.equal((await call('GET','/api/me',undefined,p.token)).status,401);
 assert.equal((await call('POST','/api/account/recover',{username:'fixture',password:PASSWORD,recoveryCode:p.recoveryCode})).status,401);assert.equal((await call('POST','/api/account/confirm-recovery',{recoveryCode:r.body.recoveryCode},r.body.token)).status,200);
}));
test('expired/async-failed checkout can retry without granting inventory',()=>withApp(async({confirmed,buy,fake,webhook})=>{
 const p=await confirmed();await buy(p.token);let s=[...fake.sessions.values()][0];s.status='expired';s.url=null;assert.equal((await webhook(s,'checkout.session.expired')).status,200);assert.equal((await buy(p.token)).status,200);assert.equal(fake.sessions.size,2);
 s=[...fake.sessions.values()][1];await webhook(s,'checkout.session.async_payment_failed');assert.equal((await buy(p.token)).status,200);assert.equal(fake.sessions.size,3);
}));
test('old password login cannot issue valid session after concurrent recovery',()=>withApp(async({call,register})=>{
 const p=await register();const [recovered,logged]=await Promise.all([call('POST','/api/account/recover',{username:'fixture',password:PASSWORD+'new',recoveryCode:p.recoveryCode}),call('POST','/api/account/login',{username:'fixture',password:PASSWORD})]);assert.equal(recovered.status,200);
 if(logged.status===200)assert.equal((await call('GET','/api/me',undefined,logged.body.token)).status,401);else assert.equal(logged.status,401);
}));
test('legacy forged paid look never appears in challenge snapshots',()=>onDisk(dbFile=>withApp(async({call,register})=>{
 const p=await register(),{db}=openDb(dbFile);db.prepare('UPDATE players SET look = ? WHERE id = ?').run('{"band":"supporter"}',p.playerId);db.close();const c=await call('POST','/api/challenges',{kind:'endless'},p.token);assert.equal(c.status,200);assert.equal(c.body.entries[0].look.band,'yellow');
},{dbFile})));
test('concurrent checkout retry after expiry before webhook creates single replacement',()=>withApp(async({confirmed,buy,fake})=>{
 const p=await confirmed();await buy(p.token);[...fake.sessions.values()][0].status='expired';const both=await Promise.all([buy(p.token),buy(p.token)]);assert.ok(both.every(r=>r.status===200));assert.equal(both[0].body.url,both[1].body.url);assert.equal(fake.sessions.size,2);
}));
test('recovery keeps paid inventory, Chalk and upgrades',()=>onDisk(dbFile=>withApp(async({call,confirmed,buy,fake,webhook})=>{
 const p=await confirmed(),{db}=openDb(dbFile);db.prepare('UPDATE players SET upgrades = ? WHERE id = ?').run('{"spring":1}',p.playerId);db.prepare('INSERT INTO runs(player_id,kind,day,seed,height,score,bars,hops,replay,replay_hash,created_at,coins) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(p.playerId,'endless',0,1,10,100,5,5,'fixture','wallet-fixture',1,200);db.close();
 await buy(p.token);const s=[...fake.sessions.values()][0];fake.pay(s);await webhook(s);const r=await call('POST','/api/account/recover',{username:'fixture',password:PASSWORD+'new',recoveryCode:p.recoveryCode});assert.equal(r.status,200);assert.equal(r.body.earned,200);assert.equal(r.body.upgrades.spring,1);assert.ok(r.body.inventory.some(i=>i.id==='supporter'));
},{dbFile})));
test('live key and readiness flag with memory DB cannot enable provider',async()=>{
 const names=['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','RTB_PAYMENTS_MODE','RTB_PAYMENT_STORAGE_READY','RTB_DB'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 try{Object.assign(process.env,{STRIPE_SECRET_KEY:'sk_live_offline_invalid_fixture',STRIPE_WEBHOOK_SECRET:SECRET,RTB_PAYMENTS_MODE:'test',RTB_PAYMENT_STORAGE_READY:'1',RTB_DB:':memory:'});await withApp(async({call})=>assert.equal((await call('GET','/api/shop')).body.checkoutEnabled,false),{mock:false});process.env.STRIPE_SECRET_KEY='sk_test_offline_invalid_fixture';await withApp(async({call})=>assert.equal((await call('GET','/api/shop')).body.checkoutEnabled,false),{mock:false});}finally{for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];}
});
test('malformed raw URL is400 without terminating process',async()=>{
 const http=require('node:http'),app=createApp({dbFile:':memory:',pool:{close:async()=>{}}});await new Promise(r=>app.listen(0,r));try{const status=await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:app.address().port,path:'//[',method:'GET'},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});assert.equal(status,400);assert.equal((await fetch('http://127.0.0.1:'+app.address().port+'/api/health')).status,200);}finally{await app.closeAll();}
});
