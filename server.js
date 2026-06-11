const express=require("express"),helmet=require("helmet"),fs=require("fs"),path=require("path"),crypto=require("crypto");
let pdfParse=null,mammoth=null,XLSX=null;
try{pdfParse=require("pdf-parse")}catch(e){}
try{mammoth=require("mammoth")}catch(e){}
try{XLSX=require("xlsx")}catch(e){}

const app=express(),PORT=process.env.PORT||10000;
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:"35mb"}));
app.use(express.static(path.join(__dirname,"public")));

const DATA=path.join(__dirname,"data");
const USERS=path.join(DATA,"users.json");
const SETTINGS=path.join(DATA,"settings.json");
const PROMPTS=path.join(DATA,"prompts.json");
const KNOWLEDGE=path.join(DATA,"knowledge.md");
const EXPORTS=path.join(__dirname,"exports");
fs.mkdirSync(DATA,{recursive:true});fs.mkdirSync(EXPORTS,{recursive:true});

const KEYS=["chat","pesquisa","tecnico","atendimento","programador","marketing","usuarios","configuracoes","imagem","editarImagem","video","documentos","sites","codigo","arquivos"];
const DEF={
 admin:Object.fromEntries(KEYS.map(k=>[k,true])),
 atendente:{chat:true,pesquisa:true,tecnico:false,atendimento:true,programador:false,marketing:true,usuarios:false,configuracoes:false,imagem:true,editarImagem:true,video:false,documentos:true,sites:false,codigo:false,arquivos:true},
 tecnico:{chat:true,pesquisa:true,tecnico:true,atendimento:false,programador:false,marketing:false,usuarios:false,configuracoes:false,imagem:true,editarImagem:true,video:false,documentos:true,sites:false,codigo:false,arquivos:true},
 programador:{chat:true,pesquisa:true,tecnico:false,atendimento:false,programador:true,marketing:false,usuarios:false,configuracoes:false,imagem:true,editarImagem:true,video:false,documentos:true,sites:true,codigo:true,arquivos:true},
 marketing:{chat:true,pesquisa:true,tecnico:false,atendimento:true,programador:false,marketing:true,usuarios:false,configuracoes:false,imagem:true,editarImagem:true,video:true,documentos:true,sites:false,codigo:false,arquivos:true}
};

function rj(f,d){try{return fs.existsSync(f)?JSON.parse(fs.readFileSync(f,"utf8")):d}catch{return d}}
function wj(f,d){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(d,null,2),"utf8")}
function rt(f){try{return fs.existsSync(f)?fs.readFileSync(f,"utf8"):""}catch{return""}}
function validMode(m){return KEYS.includes(m)||m==="rapido"}
function normP(role,p={}){if(role==="admin")return {...DEF.admin};let b=DEF[role]||DEF.atendente,o={};KEYS.forEach(k=>o[k]=!!(p[k]??b[k]));return o}
function norm(u){let role=DEF[u.role]?u.role:"atendente";return{id:u.id||"u_"+crypto.randomBytes(8).toString("hex"),username:String(u.username||"").trim(),password:String(u.password||""),name:String(u.name||u.username||"Usuário").trim(),role,active:u.active!==false,permissions:normP(role,u.permissions||{})}}
function clean(u){u=norm(u);return{id:u.id,username:u.username,name:u.name,role:u.role,active:u.active,permissions:u.permissions}}
function ensureAdminUser(){
 const admin={id:"admin_olitech",username:"olitech",password:"051309",name:"Olitech Admin",role:"admin",active:true,permissions:DEF.admin};
 let us=rj(USERS,[]),i=us.findIndex(u=>u.username==="olitech"||u.id==="admin_olitech");
 if(i>=0)us[i]={...us[i],...admin}; else us.unshift(admin);
 wj(USERS,us.map(norm));return clean(admin);
}
function users(){ensureAdminUser();let us=rj(USERS,[]).map(norm);wj(USERS,us);return us}
function settings(){
 let s=rj(SETTINGS,{appName:"OLITECH I.A V5.3",subtitle:"Gemini, pesquisa, imagens relacionadas, arquivos, sistemas, sites e atendimento.",logoType:"url",logoText:"IA",logoUrl:"/assets/olitech-ia-logo.png",logoData:"",defaultMode:"pesquisa"});
 s.appName="OLITECH I.A V5.3";
 s.subtitle="Gemini, pesquisa, imagens relacionadas, arquivos, sistemas, sites e atendimento.";
 if(!validMode(s.defaultMode)||s.defaultMode==="imagem")s.defaultMode="pesquisa";
 return s
}

const AUTH_SECRET=process.env.AUTH_SECRET||"olitech-ia-secret-local-2026";
function signToken(payload){const body=Buffer.from(JSON.stringify(payload)).toString("base64url");const sig=crypto.createHmac("sha256",AUTH_SECRET).update(body).digest("base64url");return body+"."+sig}
function verifySignedToken(t){if(!t||!t.includes("."))return null;const [body,sig]=t.split(".");const exp=crypto.createHmac("sha256",AUTH_SECRET).update(body).digest("base64url");if(sig!==exp)return null;try{const p=JSON.parse(Buffer.from(body,"base64url").toString("utf8"));if(!p.uid||!p.exp||Date.now()>p.exp)return null;return p}catch{return null}}
function token(req){let a=req.headers.authorization||"";return a.startsWith("Bearer ")?a.slice(7):""}
function user(req){const p=verifySignedToken(token(req));if(!p)return null;let u=users().find(x=>x.id===p.uid&&x.active);return u?clean(u):null}
function auth(req,res,next){let u=user(req);if(!u)return res.status(401).json({error:"Não autenticado. Faça login novamente."});req.user=u;next()}
function has(u,p){return u&&(u.role==="admin"||u.permissions?.[p])}
function perm(p){return(req,res,next)=>has(req.user,p)?next():res.status(403).json({error:"Sem permissão: "+p})}
function safe(n,ext){return String(n||"arquivo").replace(/[^\w\-]+/g,"_").slice(0,60)+(ext||"")}

function hasGeminiKey(){const k=String(process.env.GEMINI_API_KEY||"").trim();return k&&k.length>20&&!k.includes("sua_chave")}
async function callGeminiText(system,userText){
 if(!hasGeminiKey())return null;
 const model=process.env.GEMINI_MODEL||"gemini-2.5-flash";
 const url=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
 const body={contents:[{role:"user",parts:[{text:`${system}\n\nUsuário:\n${userText}`}]}],generationConfig:{temperature:.35,topP:.9,maxOutputTokens:4096}};
 const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error?.message||"Erro Gemini");
 return d.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("\n").trim()||null;
}
async function callGeminiVision(prompt,images){
 if(!hasGeminiKey())return null;
 const model=process.env.GEMINI_MODEL||"gemini-2.5-flash";
 const url=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
 const parts=[{text:prompt||"Analise esta imagem de forma profissional."}];
 for(const img of images||[]){const raw=String(img.data||"");parts.push({inlineData:{mimeType:img.mime||"image/png",data:raw.includes(",")?raw.split(",").pop():raw}})}
 const body={contents:[{role:"user",parts}],generationConfig:{temperature:.25,topP:.9,maxOutputTokens:4096}};
 const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error?.message||"Erro Gemini Vision");
 return d.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("\n").trim()||null;
}
function buildPollinationsUrl(prompt,opt={}){
 const width=Number(opt.width||1024),height=Number(opt.height||1024),seed=Math.floor(Math.random()*9999999);
 const enhanced=`high quality professional image, realistic, clean composition, detailed, ${String(prompt||"imagem profissional").trim()}`;
 return `https://image.pollinations.ai/prompt/${encodeURIComponent(enhanced)}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=true&safe=true&model=turbo`;
}

app.get("/api/health",(req,res)=>res.json({ok:true,version:"v5-estavel"}));
app.post("/api/login",(req,res)=>{try{ensureAdminUser();let{username,password}=req.body||{};username=String(username||"").trim();password=String(password||"");let u=users().find(x=>x.username===username&&x.password===password&&x.active);if(!u&&username==="olitech"&&password==="051309")u=ensureAdminUser();if(!u)return res.status(401).json({error:"Usuário ou senha inválidos"});let t=signToken({uid:u.id,exp:Date.now()+30*864e5});res.json({ok:true,token:t,user:clean(u),settings:settings()})}catch(e){res.status(500).json({error:"Erro no login: "+e.message})}});
app.post("/api/admin/reset-login",(req,res)=>{const admin=ensureAdminUser();const t=signToken({uid:admin.id,exp:Date.now()+30*864e5});res.json({ok:true,token:t,user:admin,settings:settings(),message:"Login admin recriado."})});
app.get("/api/admin/reset-login",(req,res)=>{const admin=ensureAdminUser();const t=signToken({uid:admin.id,exp:Date.now()+30*864e5});res.json({ok:true,token:t,user:admin,settings:settings(),message:"Login admin recriado."})});
app.post("/api/session/repair",(req,res)=>{const admin=ensureAdminUser();const t=signToken({uid:admin.id,exp:Date.now()+30*864e5});res.json({ok:true,token:t,user:admin,settings:settings(),repaired:true})});
app.post("/api/logout",auth,(req,res)=>res.json({ok:true}));
app.get("/api/me",(req,res)=>res.json({user:user(req),settings:settings()}));

app.get("/api/users",auth,perm("usuarios"),(req,res)=>res.json({users:users().map(clean),permissionKeys:KEYS,roleDefaults:DEF}));
app.post("/api/users",auth,perm("usuarios"),(req,res)=>{let b=req.body||{};if(!b.username||!b.password||!b.name||!b.role)return res.status(400).json({error:"Preencha nome, login, senha e perfil."});let us=users();if(us.some(u=>u.username.toLowerCase()===String(b.username).toLowerCase()))return res.status(400).json({error:"Login já existe."});us.push(norm({id:"u_"+crypto.randomBytes(8).toString("hex"),...b}));wj(USERS,us);res.json({ok:true,users:users().map(clean)})});
app.put("/api/users/:id",auth,perm("usuarios"),(req,res)=>{let us=users(),i=us.findIndex(u=>u.id===req.params.id),b=req.body||{};if(i<0)return res.status(404).json({error:"Usuário não encontrado."});if(b.username&&us.some(u=>u.id!==req.params.id&&u.username.toLowerCase()===String(b.username).toLowerCase()))return res.status(400).json({error:"Login já existe."});["username","name","role"].forEach(k=>{if(b[k])us[i][k]=b[k]});if(typeof b.active==="boolean")us[i].active=b.active;if(b.password)us[i].password=b.password;us[i].permissions=normP(us[i].role,b.permissions||us[i].permissions);us[i]=norm(us[i]);wj(USERS,us);res.json({ok:true,users:users().map(clean)})});
app.delete("/api/users/:id",auth,perm("usuarios"),(req,res)=>{if(req.user.id===req.params.id)return res.status(400).json({error:"Não exclua o próprio usuário."});wj(USERS,users().filter(u=>u.id!==req.params.id));res.json({ok:true,users:users().map(clean)})});

app.get("/api/settings",auth,(req,res)=>res.json({settings:settings()}));
app.put("/api/settings",auth,perm("configuracoes"),(req,res)=>{let c=settings(),b=req.body||{},mode=String((b.defaultMode??c.defaultMode??"pesquisa"));if(!validMode(mode)||mode==="imagem")mode="pesquisa";let s={appName:String(b.appName??c.appName).slice(0,80),subtitle:String(b.subtitle??c.subtitle).slice(0,180),logoType:["text","url","local"].includes(b.logoType)?b.logoType:c.logoType,logoText:String(b.logoText??c.logoText).slice(0,10),logoUrl:String(b.logoUrl??c.logoUrl).slice(0,600),logoData:String(b.logoData??c.logoData).slice(0,8000000),defaultMode:mode};wj(SETTINGS,s);res.json({ok:true,settings:s})});

app.post("/api/chat",auth,perm("chat"),async(req,res)=>{try{let{message,mode}=req.body||{};if(!message)return res.status(400).json({error:"Mensagem vazia"});mode=mode||settings().defaultMode||"pesquisa";if(!validMode(mode))mode="pesquisa";if(mode!=="rapido"&&!has(req.user,mode))return res.status(403).json({error:"Sem permissão para "+mode});let search="",err="",need=mode==="pesquisa"||/pesquis|clima|chuva|chover|tempo|preço|valor|hoje|atual|site|sistema|imagem|código|codigo|video|documento/i.test(message);if(need&&has(req.user,"pesquisa")){let r=await webSearch(String(message));search=r.text;err=r.error}let p=rj(PROMPTS,{}),k=rt(KNOWLEDGE),sys=`${p.base||"Você é a OLITECH I.A V5.3."}\n${p[mode]||""}\nBase:${k}\nPesquisa:${search||"nenhuma"}\nErro:${err||"nenhum"}`;let answer=await callAI(sys,String(message),{searchText:search,searchError:err});res.json({answer,usedSearch:!!search,searchError:err})}catch(e){res.json({answer:"Erro técnico tratado: "+e.message,usedSearch:false,searchError:e.message})}});

app.post("/api/tools/analyze-file",auth,perm("arquivos"),async(req,res)=>{try{let{name,mime,data}=req.body||{};if(!data)return res.status(400).json({error:"Arquivo vazio."});let buf=Buffer.from(String(data).split(",").pop(),"base64"),text="",lower=String(name||"").toLowerCase();if(lower.match(/\.(png|jpg|jpeg|webp|gif)$/))return res.json({ok:true,name,mime,text:`Imagem anexada: ${name}.`});if(lower.endsWith(".pdf")){if(!pdfParse)return res.json({ok:false,error:"Leitor PDF não instalado."});let p=await pdfParse(buf);text=p.text||""}else if(lower.endsWith(".docx")){if(!mammoth)return res.json({ok:false,error:"Leitor DOCX não instalado."});let r=await mammoth.extractRawText({buffer:buf});text=r.value||""}else if(lower.endsWith(".xlsx")||lower.endsWith(".xls")){if(!XLSX)return res.json({ok:false,error:"Leitor XLSX não instalado."});let wb=XLSX.read(buf,{type:"buffer"});text=wb.SheetNames.map(s=>"# "+s+"\n"+XLSX.utils.sheet_to_csv(wb.Sheets[s])).join("\n\n")}else{text=buf.toString("utf8").replace(/[^\x09\x0A\x0D\x20-\x7EÀ-ÿ]/g," ").replace(/\s{3,}/g," ")}res.json({ok:true,name,mime,text:text.slice(0,50000)})}catch(e){res.status(200).json({ok:false,error:e.message})}});

app.post("/api/tools/vision",auth,perm("arquivos"),async(req,res)=>{try{const{prompt,images}=req.body||{};if(!images||!images.length)return res.status(400).json({error:"Nenhuma imagem enviada."});if(hasGeminiKey()){const answer=await callGeminiVision(prompt||"Analise esta imagem de forma profissional.",images);return res.json({ok:true,answer})}return res.json({ok:true,answer:"Imagem recebida. Para análise visual real, configure GEMINI_API_KEY no Render."})}catch(e){return res.json({ok:false,error:e.message,answer:"Não consegui analisar a imagem agora."})}});


async function fetchPollinationsAsDataUrl(prompt,opt={}){
 const url=buildPollinationsUrl(prompt,opt);
 for(let i=0;i<3;i++){
   const r=await fetch(url,{headers:{"accept":"image/*"},redirect:"follow",signal:AbortSignal.timeout(75000)});
   const ct=(r.headers.get("content-type")||"").toLowerCase();
   if(r.ok&&ct.startsWith("image/")){
     const ab=await r.arrayBuffer();
     const b64=Buffer.from(ab).toString("base64");
     return {imageUrl:`data:${ct.split(";")[0]};base64,${b64}`,sourceUrl:url};
   }
   const txt=await r.text().catch(()=>"");
   if(txt.includes("requests already queued")||txt.includes("queue")||txt.includes("quota")){
     await new Promise(res=>setTimeout(res,2500*(i+1)));
     continue;
   }
   throw new Error("Pollinations retornou "+ct+": "+txt.slice(0,180));
 }
 throw new Error("Pollinations está em fila/ocupado. Tente novamente em alguns minutos.");
}


function xmlEscape(s){return String(s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&apos;"}[m]))}
function detectArtKind(prompt){
 const t=String(prompt||"").toLowerCase();
 if(t.includes("sol")||t.includes("sunset")||t.includes("por do sol"))return "sunset";
 if(t.includes("celular")||t.includes("iphone")||t.includes("smartphone"))return "phone";
 if(t.includes("notebook")||t.includes("computador")||t.includes("pc"))return "notebook";
 if(t.includes("game")||t.includes("ps4")||t.includes("ps5")||t.includes("xbox")||t.includes("console"))return "game";
 if(t.includes("logo"))return "logo";
 return "generic";
}
function makeInstantLocalImage(prompt,opt={}){
 const w=Number(opt.width||1024),h=Number(opt.height||1024),kind=detectArtKind(prompt);
 const title=kind==="sunset"?"PÔR DO SOL":kind==="phone"?"SMARTPHONE":kind==="notebook"?"NOTEBOOK":kind==="game"?"CONSOLE":kind==="logo"?"OLITECH I.A":"IMAGEM GERADA";
 const sub=kind==="sunset"?"arte visual profissional":kind==="logo"?"tecnologia • sistemas • inteligência":"criada pela OLITECH I.A";
 const stars=Array.from({length:90}).map((_,i)=>`<circle cx="${(i*97)%w}" cy="${(i*53)%h}" r="${(i%3)+1}" fill="#d9f3ff" opacity=".65"/>`).join("");
 let visual="";
 if(kind==="sunset"){
   visual=`<circle cx="${w/2}" cy="${h*0.47}" r="${Math.min(w,h)*0.16}" fill="#ffb45c" opacity=".95"/>
   <rect x="0" y="${h*0.47}" width="${w}" height="${h*0.53}" fill="#071a33" opacity=".72"/>
   <path d="M0 ${h*0.62} C ${w*.22} ${h*.55}, ${w*.35} ${h*.72}, ${w*.55} ${h*.63} S ${w*.82} ${h*.5}, ${w} ${h*.61}" stroke="#18a8ff" stroke-width="16" fill="none" opacity=".9"/>
   <path d="M0 ${h*0.70} C ${w*.22} ${h*.63}, ${w*.36} ${h*.80}, ${w*.58} ${h*.70} S ${w*.82} ${h*.62}, ${w} ${h*.72}" stroke="#ff8a1f" stroke-width="12" fill="none" opacity=".95"/>`;
 }else if(kind==="phone"){
   visual=`<rect x="${w/2-95}" y="${h/2-150}" width="190" height="300" rx="34" fill="#081423" stroke="#18a8ff" stroke-width="8"/><rect x="${w/2-70}" y="${h/2-105}" width="140" height="210" rx="16" fill="#123e72"/><circle cx="${w/2}" cy="${h/2+125}" r="10" fill="#9bd8ff"/>`;
 }else if(kind==="notebook"){
   visual=`<rect x="${w/2-210}" y="${h/2-120}" width="420" height="250" rx="22" fill="#081423" stroke="#18a8ff" stroke-width="8"/><rect x="${w/2-175}" y="${h/2-85}" width="350" height="160" rx="12" fill="#123e72"/><path d="M${w/2-260} ${h/2+155} H${w/2+260} L${w/2+210} ${h/2+220} H${w/2-210} Z" fill="#0d2744" stroke="#ff8a1f" stroke-width="6"/>`;
 }else if(kind==="game"){
   visual=`<rect x="${w/2-210}" y="${h/2-80}" width="420" height="160" rx="70" fill="#081423" stroke="#18a8ff" stroke-width="8"/><circle cx="${w/2-95}" cy="${h/2}" r="35" fill="#123e72"/><path d="M${w/2-118} ${h/2} H${w/2-72} M${w/2-95} ${h/2-23} V${h/2+23}" stroke="#fff" stroke-width="10" stroke-linecap="round"/><circle cx="${w/2+85}" cy="${h/2-22}" r="15" fill="#ff8a1f"/><circle cx="${w/2+130}" cy="${h/2+25}" r="15" fill="#9bd8ff"/>`;
 }else{
   visual=`<circle cx="${w/2}" cy="${h/2}" r="${Math.min(w,h)*0.16}" fill="#081423" stroke="#18a8ff" stroke-width="10"/><path d="M${w/2-90} ${h/2+20} C${w/2-35} ${h/2-95},${w/2+35} ${h/2+115},${w/2+105} ${h/2-45}" stroke="#ff8a1f" stroke-width="16" fill="none" stroke-linecap="round"/>`;
 }
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
 <defs><radialGradient id="bg" cx="50%" cy="20%" r="85%"><stop offset="0%" stop-color="#174477"/><stop offset="48%" stop-color="#071a33"/><stop offset="100%" stop-color="#020814"/></radialGradient><linearGradient id="ol" x1="0" x2="1"><stop offset="0%" stop-color="#18a8ff"/><stop offset="55%" stop-color="#fff"/><stop offset="100%" stop-color="#ff8a1f"/></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
 <rect width="${w}" height="${h}" fill="url(#bg)"/>${stars}
 <rect x="52" y="52" width="${w-104}" height="${h-104}" rx="42" fill="rgba(255,255,255,.045)" stroke="rgba(255,255,255,.22)" stroke-width="3"/>
 <text x="${w/2}" y="${h*0.18}" text-anchor="middle" fill="url(#ol)" font-size="${Math.max(48,Math.min(w,h)*0.075)}" font-family="Arial Black,Arial" font-weight="900" filter="url(#glow)">${xmlEscape(title)}</text>
 <text x="${w/2}" y="${h*0.24}" text-anchor="middle" fill="#eaf7ff" font-size="${Math.max(22,Math.min(w,h)*0.032)}" font-family="Arial" font-weight="800">${xmlEscape(sub)}</text>
 ${visual}
 <rect x="${w*.14}" y="${h*.80}" width="${w*.72}" height="${h*.09}" rx="24" fill="rgba(24,168,255,.18)" stroke="rgba(255,255,255,.24)"/>
 <text x="${w/2}" y="${h*.855}" text-anchor="middle" fill="#fff" font-size="${Math.max(20,Math.min(w,h)*0.028)}" font-family="Arial" font-weight="900">OLITECH I.A</text>
 </svg>`;
 return "data:image/svg+xml;base64,"+Buffer.from(svg,"utf8").toString("base64");
}


function cleanImageSearchQuery(q){
  return String(q||"").replace(/\b(imagens|imagem|fotos|foto|figuras)\b/gi," ").replace(/\b(de|do|da|dos|das|sobre|relacionadas|relacionada|em|no|na)\b/gi," ").replace(/\s+/g," ").trim();
}
function wantsImageSearchText(text,mode){
  const t=String(text||"").toLowerCase();
  if(mode==="imagem"||mode==="editarImagem")return false;
  if(/\b(crie|criar|gere|gerar|faça|faca|desenhe|monte|edite|editar)\b/.test(t))return false;
  return /\b(imagens|imagem|fotos|foto)\b/.test(t);
}
async function searchWikimediaImages(query){
  const q=cleanImageSearchQuery(query)||String(query||"");
  const api="https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=14&gsrsearch="+encodeURIComponent(q)+"&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=900&format=json&origin=*";
  const r=await fetch(api,{headers:{"user-agent":"OlitechIA/5.3"},signal:AbortSignal.timeout(12000)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error("Erro Wikimedia");
  return Object.values(d.query?.pages||{}).map(p=>{
    const ii=p.imageinfo?.[0]||{}, meta=ii.extmetadata||{};
    return {title:String(p.title||"").replace(/^File:/,""),imageUrl:ii.thumburl||ii.url,pageUrl:"https://commons.wikimedia.org/wiki/"+encodeURIComponent(p.title||""),source:"Wikimedia Commons",license:meta.LicenseShortName?.value||""}
  }).filter(x=>x.imageUrl&&/\.(jpg|jpeg|png|webp)(\?|$)/i.test(x.imageUrl)).slice(0,8);
}


app.post("/api/tools/image-search",auth,perm("pesquisa"),async(req,res)=>{
  try{
    const {query}=req.body||{};
    const clean=cleanImageSearchQuery(query);
    let images=[];
    try{images=await searchWikimediaImages(clean||query)}catch(e){console.log("image search falhou:",e.message)}
    if(images.length)return res.json({ok:true,query:clean||query,images,message:`Encontrei ${images.length} imagens relacionadas.`});
    return res.json({ok:false,query:clean||query,images:[],message:"Não encontrei imagens abertas relacionadas. Tente especificar melhor o local ou assunto."});
  }catch(e){return res.json({ok:false,error:e.message,images:[],message:"Não consegui pesquisar imagens agora."})}
});

app.post("/api/tools/image",auth,perm("imagem"),async(req,res)=>{
 try{
   const{prompt,width,height,images}=req.body||{};
   let userPrompt=String(prompt||"Crie uma imagem profissional.").trim();
   if(images&&images.length)userPrompt=`Crie uma nova imagem profissional baseada na imagem enviada. Pedido: ${userPrompt}.`;
   let lower=userPrompt.toLowerCase(),w=Number(width||1024),h=Number(height||1024);
   if(lower.includes("story")||lower.includes("stories")||lower.includes("status")){w=1080;h=1920}
   if(lower.includes("post")||lower.includes("instagram")){w=1080;h=1080}
   if(lower.includes("banner")||lower.includes("capa")){w=1400;h=800}
   try{
     if(typeof fetchPollinationsAsDataUrl==="function"){
       let out=await Promise.race([
         fetchPollinationsAsDataUrl(userPrompt,{width:w,height:h}),
         new Promise((_,rej)=>setTimeout(()=>rej(new Error("timeout_pollinations")),12000))
       ]);
       if(out&&out.imageUrl)return res.json({ok:true,type:"pollinations",prompt:userPrompt,imageUrl:out.imageUrl,sourceUrl:out.sourceUrl,message:"Imagem gerada gratuitamente e carregada dentro do chat."})
     }
   }catch(e){console.log("Imagem externa indisponível, usando gerador local:",e.message)}
   const local=makeInstantLocalImage(userPrompt,{width:w,height:h});
   return res.json({ok:true,type:"local_svg",prompt:userPrompt,imageUrl:local,message:"Imagem gerada instantaneamente no chat. Serviço externo gratuito estava ocupado."});
 }catch(e){
   const local=makeInstantLocalImage((req.body&&req.body.prompt)||"imagem profissional",{width:1024,height:1024});
   return res.json({ok:true,type:"local_svg",prompt:(req.body&&req.body.prompt)||"",imageUrl:local,message:"Imagem gerada localmente após erro externo."});
 }
});
app.post("/api/tools/video",auth,perm("video"),(req,res)=>{let{idea}=req.body||{};res.json({ok:true,content:`Roteiro de vídeo/reels OLITECH\nTema: ${idea}\nCena 1: abertura com logo.\nCena 2: mostrar problema.\nCena 3: mostrar solução técnica.\nCena 4: prova visual.\nCena 5: chamada para WhatsApp.`,message:"Vídeo real depende de API externa."})});
app.post("/api/tools/site",auth,perm("sites"),async(req,res)=>{let{description}=req.body||{};let prompt=`Crie uma página HTML completa, responsiva e moderna para: ${description}. Entregue em um único arquivo.`;let answer=await callAI("Você é programador web especialista.",prompt,{});let file=safe("site_olitech",".html");fs.writeFileSync(path.join(EXPORTS,file),answer,"utf8");res.json({ok:true,filename:file,url:"/exports/"+file,content:answer})});
app.use("/exports",express.static(EXPORTS));

async function webSearch(q){if(/clima|chuva|chover|tempo/i.test(q)){try{let city=q.replace(/vai chover|chover|chuva|hoje|clima|tempo|\?/gi," ").trim()||"Ibitinga SP",rr=await fetch("https://wttr.in/"+encodeURIComponent(city)+"?format=j1",{signal:AbortSignal.timeout(10000)});if(rr.ok){let d=await rr.json(),c=d.current_condition?.[0]||{},t=d.weather?.[0]||{};return{text:`Fonte wttr.in ${city}: ${c.temp_C||"?"}°C, máxima ${t.maxtempC||"?"}°C, mínima ${t.mintempC||"?"}°C.`,error:""}}}catch(e){return{text:"",error:e.message}}}try{let r=await fetch("https://api.duckduckgo.com/?q="+encodeURIComponent(q)+"&format=json&no_html=1&skip_disambig=1",{signal:AbortSignal.timeout(9000)});if(r.ok){let d=await r.json(),out=[];if(d.AbstractText)out.push(d.AbstractText+"\nFonte: "+(d.AbstractURL||"DuckDuckGo"));(d.RelatedTopics||[]).slice(0,5).forEach(x=>{if(x.Text)out.push(x.Text+"\nFonte: "+(x.FirstURL||""))});if(out.length)return{text:out.join("\n\n"),error:""}}}catch(e){return{text:"",error:e.message}}return{text:"",error:"Pesquisa externa sem resultado útil."}}
async function callAI(sys,msg,meta){if(hasGeminiKey()){try{let g=await callGeminiText(sys,msg);if(g)return g}catch(e){console.log("Gemini fallback:",e.message)}}if(process.env.GROQ_API_KEY){try{let r=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{Authorization:"Bearer "+process.env.GROQ_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.GROQ_MODEL||"llama-3.1-8b-instant",messages:[{role:"system",content:sys},{role:"user",content:msg}],temperature:.35}),signal:AbortSignal.timeout(30000)});let d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error?.message||"Erro Groq");return d.choices?.[0]?.message?.content||"Sem resposta."}catch(e){return `Não consegui acessar Gemini/Groq agora (${e.message}).\n\n${localAnswer(msg,meta)}`}}return localAnswer(msg,meta)}
function localAnswer(msg,meta){return`OLITECH I.A V5.3 - modo local\n\nRecebi:\n${msg}\n\n${meta?.searchText?("Pesquisa externa:\n"+meta.searchText):"Para respostas completas, configure GEMINI_API_KEY no Render."}`}
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log("OLITECH I.A V5.3 estável online porta "+PORT));
