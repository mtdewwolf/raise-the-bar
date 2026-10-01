'use strict';

const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createApp}=require('../server'),{openDb}=require('../db');
const {googlePlayProvider}=require('../google-play-provider');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');

const PASSWORD='correct horse fixture battery',PACKAGE='com.groves.rtb',PRODUCT='supporter_pack_test';
const accountId=user=>crypto.createHash('sha256').update('rtb-play:'+user).digest('hex');
const token=n=>'play_purchase_token_'+String(n).padStart(4,'0');

function provider(){
  const purchases=new Map();let gets=0,acks=0,failAck=false;
  return {
    purchases,
    set(n,user,state='PENDING'){const purchaseToken=token(n);purchases.set(purchaseToken,{productLineItem:[{productId:PRODUCT,productOfferDetails:{quantity:1,refundableQuantity:1,consumptionState:'CONSUMPTION_STATE_YET_TO_BE_CONSUMED'}}],purchaseStateContext:{purchaseState:state},obfuscatedExternalAccountId:accountId(user),...(state==='PURCHASED'?{purchaseCompletionTime:'2026-09-30T12:00:00Z',orderId:'GPA.fixture-'+n}:{}) ,acknowledgementState:'ACKNOWLEDGEMENT_STATE_PENDING'});return purchaseToken;},
    get gets(){return gets;},get acks(){return acks;},set failAck(value){failAck=value;},
    adapter:{
      getPurchase:async(pkg,purchaseToken)=>{assert.equal(pkg,PACKAGE);gets++;const purchase=purchases.get(purchaseToken);if(!purchase)throw new Error('not found');return purchase;},
      acknowledge:async(pkg,productId,purchaseToken)=>{assert.equal(pkg,PACKAGE);assert.equal(productId,PRODUCT);assert.ok(purchases.has(purchaseToken));acks++;if(failAck){failAck=false;throw new Error('retry fixture');}purchases.get(purchaseToken).acknowledgementState='ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';},
      verifyPushToken:async value=>{if(value!=='valid-push-token')throw new Error('bad push identity');},
    },
  };
}

async function withApp(fn,{dbFile=':memory:'}={}){
  let time=Date.UTC(2026,8,30,12),fake=provider();
  const app=createApp({dbFile,now:()=>time,publicUrl:'https://fixture.invalid',pool:{close:async()=>{}},payments:{googlePlay:{packageName:PACKAGE,productIds:{supporter_pack:PRODUCT},provider:fake.adapter}}});
  await new Promise(resolve=>app.listen(0,resolve));const base='http://127.0.0.1:'+app.address().port;
  async function call(method,url,body,bearer){const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(bearer?{Authorization:'Bearer '+bearer}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
  async function register(user='fixture'){const legacy=(await call('POST','/api/player',{})).body;const made=await call('POST','/api/account/register',{username:user,password:PASSWORD,confirmLink:true},legacy.token);assert.equal(made.status,200);assert.equal((await call('POST','/api/account/confirm-recovery',{recoveryCode:made.body.recoveryCode},made.body.token)).status,200);return made.body;}
  const verify=(sessionToken,purchaseToken)=>call('POST','/api/shop/google-play/verify',{sku:'supporter_pack',productId:PRODUCT,purchaseToken,packageName:PACKAGE},sessionToken);
  async function rtdn(data,messageId='message-1',auth='valid-push-token'){return call('POST','/api/payments/google-play/rtdn',{message:{messageId,data:Buffer.from(JSON.stringify(data)).toString('base64')}},auth);}
  try{await fn({call,register,verify,rtdn,fake,dbFile,advance:ms=>time+=ms});}finally{await app.closeAll();}
}
async function onDisk(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rtb-play-')),dbFile=path.join(dir,'state.sqlite');try{await fn(dbFile);}finally{fs.rmSync(dir,{recursive:true,force:true});}}

test('pending Play purchase grants nothing, then verified purchase grants once and retries acknowledgement',()=>withApp(async({call,register,verify,fake})=>{
  const player=await register(),purchaseToken=fake.set(1,'fixture');
  let result=await verify(player.token,purchaseToken);assert.equal(result.status,200);assert.equal(result.body.purchaseVerified,false);assert.equal(result.body.state,'pending');assert.deepEqual(result.body.entitlements,[]);assert.equal(fake.acks,0);
  fake.purchases.get(purchaseToken).purchaseStateContext.purchaseState='PURCHASED';fake.purchases.get(purchaseToken).purchaseCompletionTime='2026-09-30T12:01:00Z';fake.failAck=true;
  result=await verify(player.token,purchaseToken);assert.equal(result.status,200);assert.equal(result.body.purchaseVerified,true);assert.equal(result.body.acknowledged,false);assert.ok(result.body.entitlements.includes('band:supporter'));assert.equal(fake.acks,1);
  const reconciled=await call('POST','/api/shop/google-play/reconcile',{},player.token);assert.equal(reconciled.status,200);assert.equal(reconciled.body.purchaseVerified,true);assert.equal(fake.acks,2);
  const me=(await call('GET','/api/me',undefined,player.token)).body;assert.equal(me.inventory.filter(item=>item.id==='supporter').length,1);assert.equal(me.purchases.filter(row=>row.provider==='google_play').length,1);
}));

test('Play token, package, product, account and consumption identity fail closed',()=>withApp(async({call,register,verify,fake})=>{
  const first=await register(),second=await register('second'),purchaseToken=fake.set(2,'fixture','PURCHASED');
  assert.equal((await call('POST','/api/shop/google-play/verify',{sku:'supporter_pack',productId:PRODUCT,purchaseToken,packageName:'com.attacker.app'},first.token)).status,400);
  assert.equal((await verify(first.token,'short')).status,400);
  assert.equal((await verify(first.token,purchaseToken)).status,200);
  fake.purchases.get(purchaseToken).obfuscatedExternalAccountId=accountId('second');assert.equal((await verify(second.token,purchaseToken)).status,409);
  const consumed=fake.set(3,'fixture','PURCHASED');fake.purchases.get(consumed).productLineItem[0].productOfferDetails.consumptionState='CONSUMPTION_STATE_CONSUMED';assert.equal((await verify(first.token,consumed)).status,422);
}));

test('authenticated RTDN is authoritative, deduplicated and revokes only the Play source',()=>onDisk(dbFile=>withApp(async({call,register,verify,rtdn,fake})=>{
  const player=await register(),purchaseToken=fake.set(4,'fixture','PURCHASED');await verify(player.token,purchaseToken);
  assert.equal((await call('PATCH','/api/me',{look:{band:'supporter'}},player.token)).status,200);
  const {db}=openDb(dbFile);db.prepare(`INSERT INTO purchase_orders (id,player_id,sku,amount,currency,status,price_id,product_id,integration_identifier,created_at,updated_at) VALUES (?,?,?,?,?,'paid',?,?,?,?,?)`).run('stripe-source',player.playerId,'supporter_pack',499,'usd','price_fixture','prod_fixture','raise_the_bar_web_fixture',1,1);db.close();
  assert.equal((await rtdn({packageName:PACKAGE,oneTimeProductNotification:{notificationType:1,purchaseToken,sku:PRODUCT}},'auth-fail','wrong')).status,401);
  const badPackage=await rtdn({packageName:'com.attacker.app',oneTimeProductNotification:{notificationType:1,purchaseToken,sku:PRODUCT}},'bad-package');assert.equal(badPackage.status,400);
  fake.purchases.get(purchaseToken).productLineItem[0].productOfferDetails.refundableQuantity=0;
  const event={packageName:PACKAGE,voidedPurchaseNotification:{purchaseToken,orderId:'GPA.fixture-4',productType:2,refundType:1}};
  const before=fake.gets;assert.equal((await rtdn(event,'void-1')).status,200);assert.equal((await rtdn(event,'void-1')).status,200);assert.equal(fake.gets,before+1);
  let me=(await call('GET','/api/me',undefined,player.token)).body;assert.equal(me.purchases.find(row=>row.provider==='google_play').status,'revoked');assert.ok(me.inventory.some(item=>item.id==='supporter'));assert.equal(me.look.band,'supporter');
  const reopened=openDb(dbFile);reopened.db.prepare("UPDATE purchase_orders SET status='revoked' WHERE id='stripe-source'").run();reopened.db.close();
  assert.equal((await rtdn(event,'void-2')).status,200);me=(await call('GET','/api/me',undefined,player.token)).body;assert.ok(!me.inventory.some(item=>item.id==='supporter'));assert.equal(me.look.band,'yellow');
},{dbFile})));

test('authenticated Play test notifications are acknowledged without purchase processing',()=>onDisk(dbFile=>withApp(async({call,register,rtdn,fake})=>{
  const player=await register(),purchaseToken=fake.set(5,'fixture','PURCHASED'),before=fake.gets;
  const testEvent={packageName:PACKAGE,testNotification:{version:'1.0'}};
  assert.equal((await rtdn(testEvent,'test-no-auth','wrong')).status,401);
  assert.equal((await rtdn({...testEvent,packageName:'com.attacker.app'},'test-bad-package')).status,400);
  assert.equal((await rtdn({packageName:PACKAGE,testNotification:{version:'2.0'}},'test-bad-version')).status,400);
  assert.equal((await rtdn({...testEvent,oneTimeProductNotification:{notificationType:1,purchaseToken,sku:PRODUCT}},'test-mixed')).status,400);
  assert.equal((await rtdn(testEvent,'test-1')).status,200);
  assert.equal((await rtdn(testEvent,'test-1')).status,200);
  assert.equal(fake.gets,before);
  let me=(await call('GET','/api/me',undefined,player.token)).body;
  assert.ok(!me.inventory.some(item=>item.id==='supporter'));
  const opened=openDb(dbFile);const eventTypes=opened.db.prepare('SELECT type FROM google_play_events ORDER BY id').all().map(row=>row.type);opened.db.close();assert.deepEqual(eventTypes,['test']);

  const realEvent={packageName:PACKAGE,oneTimeProductNotification:{notificationType:1,purchaseToken,sku:PRODUCT}};
  assert.equal((await rtdn(realEvent,'purchase-1')).status,200);assert.equal(fake.gets,before+1);
  me=(await call('GET','/api/me',undefined,player.token)).body;assert.ok(me.inventory.some(item=>item.id==='supporter'));
},{dbFile})));

test('Google Play is disabled without the complete server verification configuration',async()=>{
  const app=createApp({dbFile:':memory:',pool:{close:async()=>{}}});await new Promise(resolve=>app.listen(0,resolve));
  try{const shop=await fetch('http://127.0.0.1:'+app.address().port+'/api/shop').then(response=>response.json());assert.equal(shop.playBillingEnabled,false);}finally{await app.closeAll();}
});

test('production Google Play configuration accepts only the permanent Console package',()=>{
  const names=['RTB_GOOGLE_PLAY_ENABLED','RTB_GOOGLE_PLAY_PACKAGE','GOOGLE_PLAY_PRODUCT_SUPPORTER_PACK','RTB_GOOGLE_PLAY_PUBSUB_AUDIENCE','RTB_GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT'];
  const prior=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  try{
    Object.assign(process.env,{RTB_GOOGLE_PLAY_ENABLED:'1',GOOGLE_PLAY_PRODUCT_SUPPORTER_PACK:PRODUCT,RTB_GOOGLE_PLAY_PUBSUB_AUDIENCE:'https://fixture.invalid/api/payments/google-play/rtdn',RTB_GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT:'push@fixture.invalid'});
    process.env.RTB_GOOGLE_PLAY_PACKAGE='com.attacker.app';assert.equal(googlePlayProvider().enabled,false);
    process.env.RTB_GOOGLE_PLAY_PACKAGE=PACKAGE;assert.equal(googlePlayProvider().enabled,true);
  }finally{for(const name of names)if(prior[name]===undefined)delete process.env[name];else process.env[name]=prior[name];}
});

test('production Pub/Sub verification uses OIDC audience and verified service-account identity',async()=>{
  const names=['RTB_GOOGLE_PLAY_ENABLED','RTB_GOOGLE_PLAY_PACKAGE','GOOGLE_PLAY_PRODUCT_SUPPORTER_PACK','RTB_GOOGLE_PLAY_PUBSUB_AUDIENCE','RTB_GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT'];
  const prior=Object.fromEntries(names.map(name=>[name,process.env[name]])),audience='https://fixture.invalid/api/payments/google-play/rtdn',email='push@fixture.invalid';
  try{
    Object.assign(process.env,{RTB_GOOGLE_PLAY_ENABLED:'1',RTB_GOOGLE_PLAY_PACKAGE:PACKAGE,GOOGLE_PLAY_PRODUCT_SUPPORTER_PACK:PRODUCT,RTB_GOOGLE_PLAY_PUBSUB_AUDIENCE:audience,RTB_GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT:email});
    const payloads={valid:{email,email_verified:true},unverified:{email,email_verified:false},wrong_identity:{email:'attacker@fixture.invalid',email_verified:true}};
    const calls=[],oidcClient={verifyIdToken:async options=>{calls.push(options);if(options.idToken==='wrong_audience')throw new Error('Wrong recipient');return {getPayload:()=>payloads[options.idToken]};}};
    const developerAuth={verifyIdToken:()=>{throw new Error('Developer API auth must not verify OIDC tokens');},getClient:async()=>({request:async()=>({data:{}})})};
    const play=googlePlayProvider({auth:developerAuth,oidcClient});
    assert.equal((await play.verifyPushToken('valid')).email,email);
    await assert.rejects(play.verifyPushToken('wrong_audience'),/Wrong recipient/);
    await assert.rejects(play.verifyPushToken('unverified'),/Unexpected Pub\/Sub identity/);
    await assert.rejects(play.verifyPushToken('wrong_identity'),/Unexpected Pub\/Sub identity/);
    assert.deepEqual(calls.map(call=>call.audience),[audience,audience,audience,audience]);
  }finally{for(const name of names)if(prior[name]===undefined)delete process.env[name];else process.env[name]=prior[name];}
});
