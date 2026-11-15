/** PR27: suggestions are *review metadata*, never automatic Yjs changes.
 * Current Clerk identity + live Convex ACL + lease are enforced server-side.
 * No queue, local persistence, replay after reconnect or production integration.
 */
const BLOCK=/^[A-Za-z0-9_.:@-]{1,128}$/;
const OP=/^[A-Za-z0-9_-]{8,96}$/;
const states=new Set(["pending","accepted","rejected"]);
const operationId=()=>crypto.randomUUID().replaceAll("-","");
export function normalizeSuggestions(rows) {
  if(!Array.isArray(rows)||rows.length>32)throw Error("INVALID_SUGGESTION_LIST");
  const ids=new Set();
  return rows.map(r=>{
    if(!r||typeof r.suggestionId!=="string"||!r.suggestionId||ids.has(r.suggestionId)||
      typeof r.blockId!=="string"||!BLOCK.test(r.blockId)||
      !Number.isSafeInteger(r.baseSeq)||r.baseSeq<0||
      typeof r.originalText!=="string"||r.originalText.length>2000||
      typeof r.replacementText!=="string"||r.replacementText.length>2000||
      !r.replacementText.trim()||r.originalText===r.replacementText||
      typeof r.note!=="string"||r.note.length>500||
      !states.has(r.status)||!Number.isSafeInteger(r.revision)||r.revision<1||
      !(r.proposedBy===null||(typeof r.proposedBy==="string"&&r.proposedBy.length>0))||
      !(r.reviewedBy===null||(typeof r.reviewedBy==="string"&&r.reviewedBy.length>0))||
      typeof r.canReview!=="boolean"||!Number.isSafeInteger(r.createdAt))
      throw Error("INVALID_SUGGESTION");
    ids.add(r.suggestionId);
    return {suggestionId:r.suggestionId,blockId:r.blockId,baseSeq:r.baseSeq,
      originalText:r.originalText,replacementText:r.replacementText,note:r.note,
      status:r.status,revision:r.revision,proposedBy:r.proposedBy,
      reviewedBy:r.reviewedBy,canReview:r.canReview,createdAt:r.createdAt};
  });
}
export class LabSuggestionClient {
  constructor({provider,onChange=()=>{},onError=()=>{},now=()=>Date.now()}){
    if(!provider?.transport||typeof provider.on!=="function"||typeof provider.off!=="function")
      throw Error("SANDBOX_PROVIDER_REQUIRED");
    this.provider=provider;this.transport=provider.transport;
    this.onChange=onChange;this.onError=onError;this.now=now;
    this.started=false;this.generation=0;this.sessionId=null;
    this.offAccess=null;this.offSuggestions=null;
    this.canSuggest=false;this.canReview=false;this.suggestions=[];
    this._status=()=>this.reconcile();
  }
  _live(){
    const p=this.provider;
    return p.state==="online"&&!!p.session?.sessionId&&
      p.accountId===p.session.accountId&&
      Number.isFinite(p.session.expiresAt)&&p.session.expiresAt>this.now();
  }
  _snapshot(){
    this.onChange({connected:this._live()&&!!this.sessionId,
      canSuggest:this.canSuggest,canReview:this.canReview,
      suggestions:this.suggestions.slice()});
  }
  _clear(){
    this.generation++;
    this.offAccess?.();this.offSuggestions?.();
    this.offAccess=null;this.offSuggestions=null;this.sessionId=null;
    this.canSuggest=false;this.canReview=false;this.suggestions=[];
    this._snapshot();
  }
  _fail(error,gen){
    if(gen!==this.generation)return;
    this._clear();
    this.onError(error instanceof Error?error:Error(String(error)));
  }
  start(){
    if(this.started)return;
    this.started=true;this.provider.on("status",this._status);
    this.reconcile();
  }
  reconcile(){
    if(!this.started)return;
    if(!this._live()){if(this.sessionId)this._clear();return;}
    const sessionId=this.provider.session.sessionId;
    if(this.sessionId===sessionId)return;
    this._clear();this.sessionId=sessionId;
    const gen=this.generation;
    if(typeof this.transport.watchSuggestionAccess!=="function"||
       typeof this.transport.watchSuggestions!=="function"){
      this._fail(Error("SUGGESTION_TRANSPORT_UNAVAILABLE"),gen);return;
    }
    const valid=()=>this.started&&gen===this.generation&&this._live()&&this.sessionId===sessionId;
    try{
      this.offAccess=this.transport.watchSuggestionAccess({sessionId},permissions=>{
        if(!valid())return;
        if(!permissions||typeof permissions.canSuggest!=="boolean"||
           typeof permissions.canReview!=="boolean"){
          this._fail(Error("INVALID_SUGGESTION_PERMISSION"),gen);return;
        }
        this.canSuggest=permissions.canSuggest;this.canReview=permissions.canReview;
        this._snapshot();
      },error=>this._fail(error,gen));
      this.offSuggestions=this.transport.watchSuggestions({sessionId},rows=>{
        if(!valid())return;
        try{this.suggestions=normalizeSuggestions(rows);this._snapshot();}
        catch(e){this._fail(e,gen);}
      },error=>this._fail(error,gen));
    }catch(e){this._fail(e,gen);}
    this._snapshot();
  }
  async _write(method,payload,capability){
    if(!this.started||!this._live()||!this.sessionId||
       !(capability==="suggest"?this.canSuggest:this.canReview))
      throw Error("SUGGESTION_PERMISSION_REQUIRED");
    const gen=this.generation,sessionId=this.sessionId;
    const result=await this.transport[method]({sessionId,...payload});
    if(gen!==this.generation||this.sessionId!==sessionId||!this._live())
      throw Error("SUGGESTION_SESSION_CHANGED_AFTER_WRITE");
    return result;
  }
  async propose({blockId,originalText,replacementText,note="",expectedHeadSeq,operationId:op=operationId()}){
    if(!BLOCK.test(blockId??"")||typeof originalText!=="string"||
       typeof replacementText!=="string"||typeof note!=="string"||
       originalText.length>2000||replacementText.length>2000||
       !replacementText.trim()||originalText===replacementText||
       note.length>500||!Number.isSafeInteger(expectedHeadSeq)||
       expectedHeadSeq<0||!OP.test(op))throw Error("INVALID_SUGGESTION_DRAFT");
    return this._write("createSuggestion",
      {blockId,originalText,replacementText,note,expectedHeadSeq,operationId:op},"suggest");
  }
  async review({suggestionId,expectedRevision,expectedHeadSeq,decision,operationId:op=operationId()}){
    const current=this.suggestions.find(s=>s.suggestionId===suggestionId);
    if(!current||!current.canReview||current.status!=="pending"||
       current.revision!==expectedRevision||current.baseSeq!==expectedHeadSeq||
       !["accept","reject"].includes(decision)||!OP.test(op))
      throw Error("SUGGESTION_REVIEW_NOT_ALLOWED");
    return this._write("reviewSuggestion",
      {suggestionId,expectedRevision,expectedHeadSeq,decision,operationId:op},"review");
  }
  stop(){
    if(!this.started)return;
    this.started=false;this.provider.off("status",this._status);this._clear();
  }
}
