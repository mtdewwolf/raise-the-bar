'use strict';

const {GoogleAuth,OAuth2Client}=require('google-auth-library');

const API='https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const PLAY_PACKAGE='com.groves.rtb';
const enc=encodeURIComponent;

function googlePlayProvider(config={}) {
  const packageName=config.packageName||process.env.RTB_GOOGLE_PLAY_PACKAGE||'';
  const productIds=config.productIds||{supporter_pack:process.env.GOOGLE_PLAY_PRODUCT_SUPPORTER_PACK||''};
  const audience=config.audience||process.env.RTB_GOOGLE_PLAY_PUBSUB_AUDIENCE||'';
  const pushServiceAccount=config.pushServiceAccount||process.env.RTB_GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT||'';
  const configured=process.env.RTB_GOOGLE_PLAY_ENABLED==='1'&&packageName===PLAY_PACKAGE&&Object.values(productIds).every(id=>/^[a-z0-9_.]+$/.test(id))&&/^https:\/\//.test(audience)&&/^[^@\s]+@[^@\s]+$/.test(pushServiceAccount);
  if(!config.provider&&!configured)return {enabled:false,packageName,productIds};
  if(config.provider)return {enabled:true,packageName,productIds,audience,pushServiceAccount,...config.provider};

  // Android Publisher calls use application credentials, while Pub/Sub push
  // bearer tokens are OIDC ID tokens and must be verified by an OAuth2 client.
  const auth=config.auth||new GoogleAuth({scopes:['https://www.googleapis.com/auth/androidpublisher']});
  const oidcClient=config.oidcClient||new OAuth2Client();
  async function request(method,url,data){
    const client=await auth.getClient();
    const response=await client.request({method,url,data,timeout:15000});
    return response.data;
  }
  return {
    enabled:true,packageName,productIds,audience,pushServiceAccount,
    getPurchase:(pkg,token)=>request('GET',`${API}/${enc(pkg)}/purchases/productsv2/tokens/${enc(token)}`),
    acknowledge:(pkg,productId,token)=>request('POST',`${API}/${enc(pkg)}/purchases/products/${enc(productId)}/tokens/${enc(token)}:acknowledge`,{}),
    async verifyPushToken(token){
      const ticket=await oidcClient.verifyIdToken({idToken:token,audience});
      const payload=ticket.getPayload();
      if(payload?.email_verified!==true||payload.email!==pushServiceAccount)throw new Error('Unexpected Pub/Sub identity');
      return payload;
    },
  };
}

module.exports={googlePlayProvider};
