'use strict';
// Free legacy achievements are preserved, never interchangeable with paid inventory.
const LEGACY_ACHIEVEMENTS=new Set(['first_hop','bar5','h10','h25','h50','h100','clutch','saved','skipper','hand_over_hand','on_empty','hops10','mat','flyer','daily','streak3','ghostbuster','share','top10','daily_champ','zone_roof','zone_clouds','zone_space','wobbly','icy','first_upgrade','maxed']);
const DEFAULTS={hat:'none',jersey:'red',band:'yellow',back:'none',suit:'none'};
const ITEMS=[
 ['hat','none'],['hat','cap','h10'],['hat','cone','mat'],['hat','party','streak3'],['hat','crown','top10'],['hat','helmet','zone_space'],
 ['jersey','red'],['jersey','blue','bar5'],['jersey','ref','hops10'],['jersey','gold','h25'],['jersey','cloud','wobbly'],['jersey','rainbow','daily_champ'],
 ['band','yellow'],['band','pink','first_hop'],['band','white','on_empty'],['band','ice','icy'],['band','flame','clutch'],
 ['back','none'],['back','cape','saved'],['back','jetpack','zone_roof'],['back','wings','zone_clouds'],
 ['suit','none'],['suit','banana','flyer'],['suit','salmon','ghostbuster'],
].map(([slot,id,achievement])=>({slot,id,achievement}));
const PRODUCTS=Object.freeze({supporter_pack:Object.freeze({sku:'supporter_pack',name:'Supporter headband (test)',amount:499,currency:'usd',items:[{slot:'band',id:'supporter'}]})});
function earnedInventory(achievements){return ITEMS.filter(i=>!i.achievement||achievements.includes(i.achievement)).map(({slot,id})=>({slot,id}));}
module.exports={LEGACY_ACHIEVEMENTS,DEFAULTS,PRODUCTS,earnedInventory};
