export const money=(cents:number)=>new Intl.NumberFormat("fr-MA",{style:"currency",currency:"MAD"}).format(cents/100);
export const toCents=(value:string)=>{const normalized=value.trim().replace(",",".");if(!/^\d+(\.\d{0,2})?$/.test(normalized))return null;return Math.round(Number(normalized)*100)};
export type CartLine={productId:number;name:string;quantity:number;unitPriceCents:number;discountCents:number;stock:number;productType:string};
export const cartTotal=(items:CartLine[],discount=0)=>items.reduce((sum,x)=>sum+x.quantity*x.unitPriceCents-x.discountCents,0)-discount;
export class ScannerBuffer{private value="";private last=0;private recent="";private recentAt=0;feed(key:string,at=Date.now()){if(at-this.last>80)this.value="";this.last=at;if(key==="Enter"){const code=this.value;this.value="";if(code.length>=3&&!(code===this.recent&&at-this.recentAt<1000)){this.recent=code;this.recentAt=at;return code}return null}if(key.length===1)this.value+=key;return null}}
