export const money=(cents:number)=>new Intl.NumberFormat("fr-MA",{style:"currency",currency:"MAD"}).format(cents/100);
export const toCents=(value:string)=>{const normalized=value.trim().replace(",",".");if(!/^\d+(\.\d{0,2})?$/.test(normalized))return null;return Math.round(Number(normalized)*100)};
export type CartLine={productId:number;name:string;quantity:number;unitPriceCents:number;discountCents:number;stock:number;productType:string};
export const cartTotal=(items:CartLine[],discount=0)=>items.reduce((sum,x)=>sum+x.quantity*x.unitPriceCents-x.discountCents,0)-discount;
export const denominationTotal=(counts:Record<number,number>)=>[20000,10000,5000,2000,1000,500,200,100,50].reduce((sum,d)=>sum+d*Math.max(0,Math.floor(counts[d]||0)),0);
export const returnAllocation=(value:number,remainingCredit:number)=>({debtReductionCents:Math.min(value,Math.max(0,remainingCredit)),cashRefundCents:Math.max(0,value-Math.max(0,remainingCredit))});
export class ScannerBuffer{private value="";private last=0;private recent="";private recentAt=0;feed(key:string,at=Date.now()){if(at-this.last>80)this.value="";this.last=at;if(key==="Enter"){const code=this.value;this.value="";if(code.length>=3&&!(code===this.recent&&at-this.recentAt<1000)){this.recent=code;this.recentAt=at;return code}return null}if(key.length===1)this.value+=key;return null}}
