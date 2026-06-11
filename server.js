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
 let s=rj(SETTINGS,{appName:"OLITECH I.A V5.1",subtitle:"Gemini, pesquisa, arquivos, imagens gratuitas, sistemas, sites e atendimento.",logoType:"url",logoText:"IA",logoUrl:"/assets/olitech-ia-logo.png",logoData:"",defaultMode:"pesquisa"});
 s.appName="OLITECH I.A V5.1";
 s.subtitle="Gemini, pesquisa, arquivos, imagens gratuitas, sistemas, sites e atendimento.";
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

app.post("/api/chat",auth,perm("chat"),async(req,res)=>{try{let{message,mode}=req.body||{};if(!message)return res.status(400).json({error:"Mensagem vazia"});mode=mode||settings().defaultMode||"pesquisa";if(!validMode(mode))mode="pesquisa";if(mode!=="rapido"&&!has(req.user,mode))return res.status(403).json({error:"Sem permissão para "+mode});let search="",err="",need=mode==="pesquisa"||/pesquis|clima|chuva|chover|tempo|preço|valor|hoje|atual|site|sistema|imagem|código|codigo|video|documento/i.test(message);if(need&&has(req.user,"pesquisa")){let r=await webSearch(String(message));search=r.text;err=r.error}let p=rj(PROMPTS,{}),k=rt(KNOWLEDGE),sys=`${p.base||"Você é a OLITECH I.A V5.1."}\n${p[mode]||""}\nBase:${k}\nPesquisa:${search||"nenhuma"}\nErro:${err||"nenhum"}`;let answer=await callAI(sys,String(message),{searchText:search,searchError:err});res.json({answer,usedSearch:!!search,searchError:err})}catch(e){res.json({answer:"Erro técnico tratado: "+e.message,usedSearch:false,searchError:e.message})}});

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

app.post("/api/tools/image",auth,perm("imagem"),async(req,res)=>{
 try{
   const{prompt,width,height,images}=req.body||{};
   let userPrompt=String(prompt||"Crie uma imagem profissional.").trim();
   if(images&&images.length)userPrompt=`Crie/edite uma nova imagem profissional baseada na imagem enviada. Pedido: ${userPrompt}. Não coloque o prompt escrito na imagem.`;
   let lower=userPrompt.toLowerCase(),w=Number(width||1024),h=Number(height||1024);
   if(lower.includes("story")||lower.includes("stories")||lower.includes("status")){w=1080;h=1920}
   if(lower.includes("post")||lower.includes("instagram")){w=1080;h=1080}
   if(lower.includes("banner")||lower.includes("capa")){w=1400;h=800}
   let out=await fetchPollinationsAsDataUrl(userPrompt,{width:w,height:h});
   res.json({ok:true,type:"pollinations",prompt:userPrompt,imageUrl:out.imageUrl,sourceUrl:out.sourceUrl,message:"Imagem gerada gratuitamente e carregada dentro do chat."})
 }catch(e){
   res.status(200).json({ok:false,error:e.message,message:"Não consegui gerar imagem agora: "+e.message})
 }
});
app.post("/api/tools/video",auth,perm("video"),(req,res)=>{let{idea}=req.body||{};res.json({ok:true,content:`Roteiro de vídeo/reels OLITECH\nTema: ${idea}\nCena 1: abertura com logo.\nCena 2: mostrar problema.\nCena 3: mostrar solução técnica.\nCena 4: prova visual.\nCena 5: chamada para WhatsApp.`,message:"Vídeo real depende de API externa."})});
app.post("/api/tools/site",auth,perm("sites"),async(req,res)=>{let{description}=req.body||{};let prompt=`Crie uma página HTML completa, responsiva e moderna para: ${description}. Entregue em um único arquivo.`;let answer=await callAI("Você é programador web especialista.",prompt,{});let file=safe("site_olitech",".html");fs.writeFileSync(path.join(EXPORTS,file),answer,"utf8");res.json({ok:true,filename:file,url:"/exports/"+file,content:answer})});
app.use("/exports",express.static(EXPORTS));

async function webSearch(q){if(/clima|chuva|chover|tempo/i.test(q)){try{let city=q.replace(/vai chover|chover|chuva|hoje|clima|tempo|\?/gi," ").trim()||"Ibitinga SP",rr=await fetch("https://wttr.in/"+encodeURIComponent(city)+"?format=j1",{signal:AbortSignal.timeout(10000)});if(rr.ok){let d=await rr.json(),c=d.current_condition?.[0]||{},t=d.weather?.[0]||{};return{text:`Fonte wttr.in ${city}: ${c.temp_C||"?"}°C, máxima ${t.maxtempC||"?"}°C, mínima ${t.mintempC||"?"}°C.`,error:""}}}catch(e){return{text:"",error:e.message}}}try{let r=await fetch("https://api.duckduckgo.com/?q="+encodeURIComponent(q)+"&format=json&no_html=1&skip_disambig=1",{signal:AbortSignal.timeout(9000)});if(r.ok){let d=await r.json(),out=[];if(d.AbstractText)out.push(d.AbstractText+"\nFonte: "+(d.AbstractURL||"DuckDuckGo"));(d.RelatedTopics||[]).slice(0,5).forEach(x=>{if(x.Text)out.push(x.Text+"\nFonte: "+(x.FirstURL||""))});if(out.length)return{text:out.join("\n\n"),error:""}}}catch(e){return{text:"",error:e.message}}return{text:"",error:"Pesquisa externa sem resultado útil."}}
async function callAI(sys,msg,meta){if(hasGeminiKey()){try{let g=await callGeminiText(sys,msg);if(g)return g}catch(e){console.log("Gemini fallback:",e.message)}}if(process.env.GROQ_API_KEY){try{let r=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{Authorization:"Bearer "+process.env.GROQ_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.GROQ_MODEL||"llama-3.1-8b-instant",messages:[{role:"system",content:sys},{role:"user",content:msg}],temperature:.35}),signal:AbortSignal.timeout(30000)});let d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error?.message||"Erro Groq");return d.choices?.[0]?.message?.content||"Sem resposta."}catch(e){return `Não consegui acessar Gemini/Groq agora (${e.message}).\n\n${localAnswer(msg,meta)}`}}return localAnswer(msg,meta)}
function localAnswer(msg,meta){return`OLITECH I.A V5.1 - modo local\n\nRecebi:\n${msg}\n\n${meta?.searchText?("Pesquisa externa:\n"+meta.searchText):"Para respostas completas, configure GEMINI_API_KEY no Render."}`}
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log("OLITECH I.A V5.1 estável online porta "+PORT));
