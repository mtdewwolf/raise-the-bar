'use strict';
const crypto=require('node:crypto');
const path=require('node:path');
const {PRODUCTS,DEFAULTS,earnedInventory}=require('./catalog');
function payments({db,q,now,auth,account,profile,readJson,HttpError,limit,publicUrl,dbFile,options={}}){
  db.exec(`CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), sku TEXT NOT NULL,
    amount INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    session_id TEXT UNIQUE, payment_intent TEXT UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS purchase_player ON purchase_orders(player_id);
    CREATE TABLE IF NOT EXISTS payment_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, processed_at INTEGER NOT NULL);`);
  const addOrderColumn=(name,definition)=>{if(!db.prepare('PRAGMA table_info(purchase_orders)').all().some(c=>c.name===name))db.exec(`ALTER TABLE purchase_orders ADD COLUMN ${name} ${definition}`);};
  addOrderColumn('price_id','TEXT');
  addOrderColumn('product_id','TEXT');
  addOrderColumn('integration_identifier','TEXT');
  const key=process.env.STRIPE_SECRET_KEY||'',webhookSecret=options.webhookSecret||process.env.STRIPE_WEBHOOK_SECRET||'';
  const priceIds=options.priceIds||Object.fromEntries(Object.keys(PRODUCTS).map(sku=>[sku,process.env['STRIPE_PRICE_'+sku.toUpperCase()]||'']));
  const durable=process.env.RTB_PAYMENT_STORAGE_READY==='1'&&dbFile!==':memory:'&&path.isAbsolute(dbFile)&&process.env.RTB_DB===dbFile;
  const mapped=Object.keys(PRODUCTS).every(sku=>/^price_[A-Za-z0-9]+$/.test(priceIds[sku]||''));
  const testConfigured=process.env.RTB_PAYMENTS_MODE==='test'&&/^(?:sk|rk)_test_/.test(key)&&webhookSecret&&durable&&mapped&&/^https:\/\//.test(publicUrl||'');
  // Injection is only a createApp test fixture, never selected by HTTP or environment.
  const stripe=options.stripe||(testConfigured?new(require('stripe'))(key,{apiVersion:'2026-08-26.dahlia',maxNetworkRetries:2,timeout:15000}):null);
  const enabled=!!stripe&&(!!options.stripe||!!testConfigured);
  const byId=db.prepare('SELECT * FROM purchase_orders WHERE id = ?');
  const orders=id=>db.prepare('SELECT * FROM purchase_orders WHERE player_id = ? ORDER BY created_at').all(id);
  function inventory(p){
    let achievements;try{achievements=JSON.parse(p.achievements||'[]');}catch{achievements=[];}if(!Array.isArray(achievements))achievements=[];
    const result=earnedInventory(achievements);
    for(const row of orders(p.id))if(row.status==='paid'&&PRODUCTS[row.sku])result.push(...PRODUCTS[row.sku].items);
    return [...new Map(result.map(i=>[i.slot+':'+i.id,i])).values()];
  }
  function sanitizeLook(p){
    let look;try{look=JSON.parse(p.look||'{}');}catch{look={};}if(!look||typeof look!=='object')look={};
    const owned=inventory(p);
    return Object.fromEntries(Object.entries(DEFAULTS).map(([slot,fallback])=>[slot,owned.some(i=>i.slot===slot&&i.id===look[slot])?look[slot]:fallback]));
  }
  function validateLook(p,raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new HttpError(400,'Invalid look');
    const owned=inventory(p),result={};
    for(const [slot,id]of Object.entries(raw)){
      if(!Object.hasOwn(DEFAULTS,slot)||typeof id!=='string'||!owned.some(i=>i.slot===slot&&i.id===id))throw new HttpError(403,'Cosmetic is unknown or not owned');
      result[slot]=id;
    }return {...DEFAULTS,...result};
  }
  const summary=p=>({inventory:inventory(p),purchases:orders(p.id).map(({sku,status})=>({sku,status})),look:sanitizeLook(p)});
  function requireAccount(req){const p=auth(req,true),info=account.info(p.id);if(!info||!info.recoveryConfirmed)throw new HttpError(403,'Save and confirm your account recovery code first');return p;}
  function requireEnabled(){if(!enabled)throw new HttpError(503,'Test checkout is unavailable until durable storage and Stripe test mode are configured');}
  const idOf=obj=>typeof obj==='string'?obj:obj&&obj.id;
  function integrationIdentifier(){
    const letters='abcdefghijklmnopqrstuvwxyz';let suffix='';
    for(let i=0;i<8;i++)suffix+=letters[crypto.randomInt(letters.length)];
    return 'raise_the_bar_web_'+suffix;
  }
  async function approvedPrice(product){
    const configured=priceIds[product.sku];
    if(!/^price_[A-Za-z0-9]+$/.test(configured||''))throw new HttpError(503,'Test checkout catalog is not configured');
    const price=await stripe.prices.retrieve(configured,{expand:['product']});
    const providerProduct=price?.product;
    if(price?.id!==configured||price.livemode!==false||price.active!==true||price.type!=='one_time'||price.recurring||price.unit_amount!==product.amount||price.currency!==product.currency||typeof providerProduct!=='object'||!/^prod_[A-Za-z0-9]+$/.test(providerProduct.id||'')||providerProduct.livemode!==false||providerProduct.active!==true||providerProduct.metadata?.sku!==product.sku)throw new HttpError(503,'Test checkout catalog does not match the approved offer');
    return {priceId:price.id,productId:providerProduct.id};
  }
  async function reconcile(order,suppliedSession){
    const sessionId=suppliedSession||order.session_id;if(!sessionId)return;
    const session=await stripe.checkout.sessions.retrieve(sessionId,{expand:['payment_intent.latest_charge','line_items.data.price.product']});
    if(session.livemode!==false||session.mode!=='payment'||session.id!==sessionId||session.metadata?.order_id!==order.id||session.client_reference_id!==String(order.player_id)||(order.session_id&&order.session_id!==session.id))throw new HttpError(422,'Checkout identity mismatch');
    const lines=session.line_items?.data;
    const linePrice=lines?.[0]?.price,lineProduct=linePrice?.product;
    if(!order.price_id||!order.product_id||session.amount_total!==order.amount||session.currency!==order.currency||!Array.isArray(lines)||lines.length!==1||lines[0].quantity!==1||lines[0].amount_total!==order.amount||linePrice?.id!==order.price_id||idOf(lineProduct)!==order.product_id||(typeof lineProduct==='object'&&lineProduct.metadata?.sku!==order.sku))throw new HttpError(422,'Checkout amount or product mismatch');
    let intent=session.payment_intent;if(typeof intent==='string')intent=await stripe.paymentIntents.retrieve(intent,{expand:['latest_charge']});
    let charge=intent?.latest_charge;if(typeof charge==='string')charge=await stripe.charges.retrieve(charge);
    const revoked=!!charge&&(charge.refunded===true||charge.amount_refunded>0||charge.disputed===true);
    const paid=session.payment_status==='paid'&&intent?.status==='succeeded'&&charge?.paid===true;
    if((paid||revoked)&&(intent.livemode!==false||intent.amount!==order.amount||intent.currency!==order.currency||intent.metadata?.order_id!==order.id||charge.livemode!==false||charge.amount!==order.amount||charge.currency!==order.currency||idOf(charge.payment_intent)!==intent.id))throw new HttpError(422,'Payment identity mismatch');
    account.transaction(()=>{
      const current=byId.get(order.id);
      const status=current.status==='revoked'||revoked?'revoked':paid?'paid':current.status==='paid'?'paid':['failed','expired'].includes(current.status)?current.status:session.status==='expired'?'expired':session.status==='complete'&&session.payment_status==='unpaid'?'processing':current.status;
      db.prepare('UPDATE purchase_orders SET session_id = ?, payment_intent = ?, status = ?, updated_at = ? WHERE id = ?').run(session.id,idOf(intent)||null,status,now(),order.id);
      const p=q.playerById.get(order.player_id);q.setLook.run(JSON.stringify(sanitizeLook(p)),p.id);
    });
  }
  async function webhook(req){
    requireEnabled();const chunks=[];let size=0;
    for await(const c of req){size+=c.length;if(size>256*1024)throw new HttpError(413,'Request too large');chunks.push(c);}
    let event;
    try{
      event=stripe.webhooks.constructEvent(Buffer.concat(chunks),req.headers['stripe-signature'],webhookSecret,300,undefined,now());
      const timestamp=Number(/(?:^|,)t=(\d+)/.exec(req.headers['stripe-signature']||'')?.[1]);
      if(!Number.isFinite(timestamp)||timestamp>Math.floor(now()/1000)+300)throw new Error('Future webhook timestamp');
    }catch{throw new HttpError(400,'Invalid webhook signature');}
    if(event.livemode!==false||typeof event.id!=='string')throw new HttpError(400,'Only Stripe test events are accepted');
    if(db.prepare('SELECT id FROM payment_events WHERE id = ?').get(event.id))return {received:true};
    const object=event.data?.object;
    if(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired'].includes(event.type)){
      const order=object?.metadata?.order_id&&byId.get(object.metadata.order_id);
      if(order){await reconcile(order,object.id);if(event.type==='checkout.session.async_payment_failed')db.prepare("UPDATE purchase_orders SET status = 'failed', updated_at = ? WHERE id = ? AND status IN ('pending','processing')").run(now(),order.id);}
    }else if(['charge.refunded','charge.dispute.created','charge.dispute.closed','refund.updated','refund.created'].includes(event.type)){
      let intentId=idOf(object?.payment_intent);
      if(!intentId&&object?.charge)intentId=idOf((await stripe.charges.retrieve(idOf(object.charge))).payment_intent);
      if(intentId){
        const intent=await stripe.paymentIntents.retrieve(intentId),order=intent.metadata?.order_id&&byId.get(intent.metadata.order_id);
        if(order){
          const charge=await stripe.charges.retrieve(idOf(intent.latest_charge));
          if(intent.livemode===false&&charge.livemode===false&&intent.amount===order.amount&&intent.currency===order.currency&&charge.amount===order.amount&&charge.currency===order.currency&&(!order.payment_intent||order.payment_intent===intentId)&&idOf(charge.payment_intent)===intentId&&(charge.refunded||charge.amount_refunded>0||charge.disputed)){
            // Terminal tombstone can precede completion and cannot be undone by old events.
            account.transaction(()=>{db.prepare("UPDATE purchase_orders SET status = 'revoked', payment_intent = ?, updated_at = ? WHERE id = ?").run(intentId,now(),order.id);const p=q.playerById.get(order.player_id);q.setLook.run(JSON.stringify(sanitizeLook(p)),p.id);});
          }if(order.session_id)await reconcile(byId.get(order.id));
        }
      }
    }
    db.prepare('INSERT OR IGNORE INTO payment_events VALUES (?,?,?)').run(event.id,event.type,now());return {received:true};
  }
  const routes={
    'GET /api/shop':()=>({mode:enabled?'test':'disabled',checkoutEnabled:enabled,items:Object.values(PRODUCTS)}),
    'POST /api/shop/checkout':async(req,ip)=>{
      const p=requireAccount(req);limit('checkout:'+p.id,6,60000);const body=await readJson(req);requireEnabled();
      if(body.channel!=='web'||/RaisingTheBarAndroid|; wv\)/i.test(req.headers['user-agent']||'')||req.headers['x-rtb-platform']==='android')throw new HttpError(403,'Native purchases are not available');
      if(Object.keys(body).some(k=>!['sku','channel'].includes(k))||!Object.hasOwn(PRODUCTS,body.sku))throw new HttpError(400,'Unknown product or unsupported checkout fields');
      const product=PRODUCTS[body.sku];
      for(const existing of orders(p.id))if(existing.sku===product.sku&&['pending','processing'].includes(existing.status)&&existing.session_id)await reconcile(existing);
      const catalog=await approvedPrice(product);
      // Provider awaits may overlap: ownership/auth and pending-order selection are atomic.
      const order=account.transaction(()=>{
        requireAccount(req);const current=orders(p.id);
        if(current.some(r=>r.sku===product.sku&&r.status==='paid'))throw new HttpError(409,'You already own this item');
        const pending=current.find(r=>r.sku===product.sku&&['pending','processing'].includes(r.status));
        if(pending){
          // Stripe may prune idempotency keys after 24h. Do not recreate an uncertain payment.
          if(!pending.session_id&&now()-pending.created_at>=23*3600000)throw new HttpError(409,'An earlier checkout needs support reconciliation before retrying');
          return pending;
        }
        const id=crypto.randomUUID(),label=integrationIdentifier();db.prepare('INSERT INTO purchase_orders (id,player_id,sku,amount,currency,price_id,product_id,integration_identifier,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,p.id,product.sku,product.amount,product.currency,catalog.priceId,catalog.productId,label,now(),now());return byId.get(id);
      });
      if(order.price_id!==catalog.priceId||order.product_id!==catalog.productId||!/^raise_the_bar_web_[a-z]{8}$/.test(order.integration_identifier||''))throw new HttpError(409,'An earlier checkout uses a different catalog mapping and needs support reconciliation');
      const session=order.session_id?await stripe.checkout.sessions.retrieve(order.session_id):await stripe.checkout.sessions.create({mode:'payment',integration_identifier:order.integration_identifier,client_reference_id:String(p.id),metadata:{order_id:order.id},payment_intent_data:{metadata:{order_id:order.id}},line_items:[{quantity:1,price:order.price_id}],success_url:publicUrl+'/?checkout=return',cancel_url:publicUrl+'/?checkout=cancel'},{idempotencyKey:'rtb-checkout-'+order.id});
      if(session.livemode!==false)throw new HttpError(502,'Unexpected checkout response');
      db.prepare('UPDATE purchase_orders SET session_id = ?, updated_at = ? WHERE id = ?').run(session.id,now(),order.id);
      if(session.url){if(!/^https:\/\/checkout\.stripe\.com\//.test(session.url))throw new HttpError(502,'Unexpected checkout response');return {state:'checkout',url:session.url};}
      await reconcile(byId.get(order.id));
      const state=byId.get(order.id).status;
      if(state==='processing'||state==='paid')return {state};
      throw new HttpError(502,'Checkout is unavailable; refresh purchases before retrying');
    },
    'POST /api/shop/restore':async req=>{const p=auth(req,true);limit('restore:'+p.id,6,60000);if(enabled)for(const order of orders(p.id))if(order.session_id)await reconcile(order);return profile(q.playerById.get(p.id));},
    'POST /api/payments/stripe/webhook':webhook,
  };
  return {routes,summary,validateLook,sanitizeLook};
}
module.exports={payments};
