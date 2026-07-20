/**
 * UOMP Browser SDK v20260720-181ead7 — fix loadEncrypted error handling
 * Self-contained bundle for browser use.
 * No Node.js dependencies. Uses Web Crypto API + window.fetch.
 */
const E=new TextEncoder(),D=new TextDecoder();

// ── Types ──────────────────────────────────────────────────
class UompError extends Error{constructor(code,msg,sid,status){super(msg);this.name='UompError';this.code=code;this.sessionId=sid;this.statusCode=status}get isRetryable(){return this.code==='NETWORK_ERROR'||this.code==='TIMEOUT'||(this.statusCode!=null&&this.statusCode>=500)}}
const UompErrorCode={ACCESS_DENIED:'ACCESS_DENIED',TOKEN_EXPIRED:'TOKEN_EXPIRED',INVALID_TOKEN:'INVALID_TOKEN',NETWORK_ERROR:'NETWORK_ERROR',TIMEOUT:'TIMEOUT',UNKNOWN:'UNKNOWN',QUOTA_EXCEEDED:'QUOTA_EXCEEDED'};

// ── Crypto (Web Crypto API) ────────────────────────────────
async function deriveMasterKey(signature,address,chain){
  const input=signature+'\n'+address.toLowerCase()+'\n'+chain+'\nuomp-store-v1';
  const enc=new TextEncoder();
  // Use PBKDF2 for reliable key derivation (works in all browsers)
  const keyMaterial=await crypto.subtle.importKey('raw',enc.encode(input),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2',salt:enc.encode('uomp-salt'),iterations:100000,hash:'SHA-256'},
    keyMaterial,{name:'AES-GCM',length:256},false,['encrypt','decrypt']
  );
}
async function encryptData(key,text){const iv=crypto.getRandomValues(new Uint8Array(12));const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,E.encode(text));return{iv:Array.from(iv),d:Array.from(new Uint8Array(ct))}}
async function decryptData(key,obj){const iv=new Uint8Array(obj.iv),data=new Uint8Array(obj.d);const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,data);return D.decode(pt)}
function createUserId(chain,address){return chain+':'+address.toLowerCase()}

// ── Transport ──────────────────────────────────────────────
class Transport{
  constructor(options={}){this.baseUrl=(options.baseUrl||'').replace(/\/$/,'');this.agentId=options.agentId;this.timeoutMs=options.timeout||15000;this.tokenFn=options.token||(()=>'')}
  token(){return this.tokenFn()}
  async request(path,init={}){
    const ctrl=new AbortController();const to=setTimeout(()=>ctrl.abort(),this.timeoutMs);
    try{
      const h={Authorization:`Bearer ${this.token()}`,Accept:'application/json',...init.headers};
      if(this.agentId&&!h['x-uomp-agent-id'])h['X-UOMP-Agent-Id']=this.agentId;
      const r=await fetch(`${this.baseUrl}${path}`,{method:init.method||'GET',headers:h,body:init.body,signal:ctrl.signal});
      if(!r.ok){let b;try{b=await r.json()}catch{b={}};throw new UompError(b.error?.code||'UNKNOWN',b.error?.message||`HTTP ${r.status}`,b.error?.session_id,r.status)}
      return r;
    }finally{clearTimeout(to)}
  }
  async getJson(path){return(await this.request(path)).json()}
}

// ── UompClient ─────────────────────────────────────────────
class UompClient{
  constructor(options={}){
    const t=options.token||'',u=options.baseUrl||'';
    this._token=t;this._info=null;
    try{const p=t.split('.')[1];const j=JSON.parse(atob(p));this._info={sessionId:j.session_id||'',agentId:j.agent_id||'',expiresAt:j.expires_at||'',scopes:j.scopes||{}};this._agentId=j.agent_id||'uomp-agent'}catch{this._agentId=options.agentId||'uomp-agent'}
    this._transport=new Transport({baseUrl:u,agentId:this._agentId,token:()=>this._token,timeout:options.timeout||15000});
    const sid=options.sessionId||this._info?.sessionId||'',aid=options.agentId||this._agentId;
    this.memory=new MemoryClient(this._transport);
    this.aggregate=new AggregateClient(this._transport);
    this.session=new SessionClient(this._transport,sid,aid);
    this.auth=new AuthClient(this._transport);
    this.audit=new AuditClient(this._transport);
  }
  get token(){return this._token}set token(v){this._token=v}
  get tokenInfo(){return this._info}
  get isGatewayOnline(){return true}
  static fromEnv(){return new UompClient({token:typeof sessionStorage!=='undefined'?sessionStorage.getItem('uomp_token')||'':'',baseUrl:'http://127.0.0.1:9374'})}
}

// ── Sub-clients ────────────────────────────────────────────
class MemoryClient{constructor(t){this.t=t}async get(key){return this.t.getJson(`/v1/memory/${encodeURIComponent(key)}`).catch(()=>null)}async getByTag(tag){const d=await this.t.getJson(`/v1/memory?tag=${encodeURIComponent(tag)}`);return d.items||[]}}
class AggregateClient{constructor(t){this.t=t}async sum(tag,f){return this.q(tag,'sum',f)}async avg(tag,f){return this.q(tag,'avg',f)}async count(tag){return this.q(tag,'count')}async min(tag,f){return this.q(tag,'min',f)}async max(tag,f){return this.q(tag,'max',f)}async q(tag,op,f){const p=new URLSearchParams({tag,op});if(f)p.set('field',f);return this.t.getJson(`/v1/memory/aggregate?${p}`)}}
class SessionClient{constructor(t,sid,aid){this.t=t;this.sid=sid;this.aid=aid}async submitDeletionProof(o={}){return this.t.getJson(`/v1/sessions/${this.sid}/deletion-proof`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deletion_proof_id:'del_'+Date.now().toString(36),session_id:this.sid,agent_id:this.aid,deleted_at:new Date().toISOString(),memory_hash:'sha256:'+this.sid,fields_accessed:o.fields||['key','value'],method:o.method||'process_termination',proof_value:'sha256:'+this.sid})})}async close(){await this.t.request(`/v1/sessions/${this.sid}/close`,{method:'POST'})}async finalize(o){const r=await this.submitDeletionProof(o);try{await this.close()}catch{}return r}}
class AuthClient{constructor(t){this.t=t}async createSession(p){return this.t.getJson('/v1/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agent_id:p.agentId,agent_name:p.agentName,requested_scopes:p.requestedScopes,duration_minutes:p.duration||30})})}async grant(sid,scopes,o){return this.t.getJson(`/v1/sessions/${sid}/grant`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({granted_scopes:scopes,profile:o?.profile||'local',audience:o?.audience,allowed_fields:o?.allowedFields,aggregation_only:o?.aggregationOnly||false,task_bound:o?.taskBound||false})})}async revoke(sid){return this.t.getJson(`/v1/sessions/${sid}/revoke`,{method:'POST'})}}
class AuditClient{constructor(t){this.t=t}async query(o={}){const p=new URLSearchParams();if(o.sessionId)p.set('session_id',o.sessionId);if(o.limit)p.set('limit',String(o.limit));const d=await this.t.getJson(`/v1/audit?${p}`);return d.logs||[]}}

// ── BrowserSDK ─────────────────────────────────────────────
const STORE_PREFIX='uomp_enc_';
const BrowserSDK={
  saveToken(t){if(typeof sessionStorage!=='undefined')sessionStorage.setItem('uomp_token',t)},
  loadToken(){return typeof sessionStorage!=='undefined'?sessionStorage.getItem('uomp_token')||'':''},
  saveGatewayUrl(u){if(typeof sessionStorage!=='undefined')sessionStorage.setItem('uomp_gateway',u)},
  loadGatewayUrl(){return typeof sessionStorage!=='undefined'?sessionStorage.getItem('uomp_gateway')||'':''},
  fromEnv(){return new UompClient({token:this.loadToken(),baseUrl:this.loadGatewayUrl()||'http://127.0.0.1:9374'})},
  createFromStorage(){return this.fromEnv()},
  async fromWallet(chain='ethereum'){
    let addr,sig;
    if(chain==='ethereum'){if(!window.ethereum)throw new Error('MetaMask not detected');const a=await window.ethereum.request({method:'eth_requestAccounts'});addr=a[0];sig=await window.ethereum.request({method:'personal_sign',params:['Authorize UOMP to access your encrypted portfolio data.\n\nThis signature does not send a transaction. It only derives your encryption key.',addr]})}
    else{if(!window.starknet)throw new Error('Argent X not detected');await window.starknet.enable();addr=window.starknet.selectedAddress;if(!addr)throw new Error('No account');const td={domain:{name:'UOMP Store',version:'1',chainId:'SN_MAIN'},types:{StarkNetDomain:[{name:'name',type:'felt'},{name:'version',type:'felt'},{name:'chainId',type:'felt'}],Message:[{name:'message',type:'felt'}]},primaryType:'Message',message:{message:'UOMP Store v1'}};const r=await window.starknet.account.signMessage(td);sig=Array.isArray(r)?r.join(','):String(r)}
    const key=await deriveMasterKey(sig,addr,chain);
    const uid=createUserId(chain,addr);
    return{key,userId:uid,chain,address:addr};
  },
  // Encrypted storage helpers
  async saveEncrypted(key,userId,data){
    const e=await encryptData(key,JSON.stringify(data));
    localStorage.setItem(STORE_PREFIX+userId,JSON.stringify(e));
  },
  async loadEncrypted(key,userId){
    const raw=localStorage.getItem(STORE_PREFIX+userId);
    if(!raw)return null;
    try{
      const d=JSON.parse(raw);
      const p=await decryptData(key,d);
      return JSON.parse(p);
    }catch(e){
      localStorage.removeItem(STORE_PREFIX+userId);
      return null;
    }
  }
};

// ── Dropbox PKCE OAuth ─────────────────────────────────────
const DB_KEY='k6k81wrvc90ke45';
const DB_REDIRECT=typeof location!=='undefined'?location.origin+location.pathname:'';
class DropboxStore{
  constructor(t){this.t=t}
  async upload(path,data){
    const r=await fetch('https://content.dropboxapi.com/2/files/upload',{method:'POST',headers:{Authorization:`Bearer ${this.t}`,'Content-Type':'application/octet-stream','Dropbox-API-Arg':JSON.stringify({path:`/Apps/UOMP/${path}`,mode:'overwrite'})},body:typeof data==='string'?E.encode(data):data});
    return r.ok;
  }
  async download(path){
    const r=await fetch('https://content.dropboxapi.com/2/files/download',{method:'POST',headers:{Authorization:`Bearer ${this.t}`,'Dropbox-API-Arg':JSON.stringify({path:`/Apps/UOMP/${path}`})}});
    if(!r.ok)return null;return D.decode(new Uint8Array(await r.arrayBuffer()));
  }
  async list(path){
    const r=await fetch('https://api.dropboxapi.com/2/files/list_folder',{method:'POST',headers:{Authorization:`Bearer ${this.t}`,'Content-Type':'application/json'},body:JSON.stringify({path:`/Apps/UOMP${path}`,limit:50})});
    if(!r.ok)return[];const d=await r.json();return d.entries||[];
  }
}
function dbToken(){return typeof sessionStorage!=='undefined'?sessionStorage.getItem('uomp_db')||'':''}
function dbSetToken(t){if(typeof sessionStorage!=='undefined')sessionStorage.setItem('uomp_db',t)}
async function connectDropbox(){
  // Check for existing token
  if(dbToken())return new DropboxStore(dbToken());

  // Open Dropbox OAuth in popup (no page reload!)
  const cv=(()=>{const a=new Uint8Array(32);crypto.getRandomValues(a);return btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')})();
  sessionStorage.setItem('uomp_db_v',cv);
  const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(cv));
  const cc=btoa(String.fromCharCode(...new Uint8Array(h))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const authUrl=`https://www.dropbox.com/oauth2/authorize?client_id=${DB_KEY}&response_type=code&code_challenge=${cc}&code_challenge_method=S256&redirect_uri=${encodeURIComponent(DB_REDIRECT)}&token_access_type=offline&scope=files.content.write%20files.content.read`;

  return new Promise((resolve,reject)=>{
    const popup=window.open(authUrl,'dropbox-auth','width=600,height=700');
    if(!popup){reject(new Error('Popup blocked. Allow popups for this site.'));return}
    const timer=setInterval(()=>{
      try{
        if(popup.closed){clearInterval(timer);reject(new Error('Dropbox login cancelled'));return}
        const url=popup.location.href;
        if(url.includes('?code=')){
          const code=new URLSearchParams(url.split('?')[1]).get('code');
          popup.close();clearInterval(timer);
          if(!code){reject(new Error('No code received'));return}
          // Exchange code for token
          fetch('https://api.dropboxapi.com/oauth2/token',{
            method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
            body:new URLSearchParams({code,grant_type:'authorization_code',client_id:DB_KEY,code_verifier:cv,redirect_uri:DB_REDIRECT})
          }).then(async r=>{
            if(!r.ok){reject(new Error('Token exchange failed'));return}
            const d=await r.json();
            dbSetToken(d.access_token);
            sessionStorage.removeItem('uomp_db_v');
            resolve(new DropboxStore(d.access_token));
          }).catch(reject);
        }
      }catch(e){/* cross-origin before redirect — ignore */}
    },500);
    setTimeout(()=>{clearInterval(timer);reject(new Error('Dropbox login timed out'))},120000);
  });
}

export { UompClient, BrowserSDK, UompError, UompErrorCode, DropboxStore, connectDropbox, encryptData, decryptData, deriveMasterKey, createUserId };
