export async function jsonRequest(url, { fetchImpl=fetch, timeoutMs=20000, attempts=2, ...options }={}) {
  for(let attempt=0;attempt<attempts;attempt++){
    let response;
    try{response=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}
    catch{throw new Error('接口网络失败或超时；未自动重试可能计费的请求');}
    if((response.status===429||response.status>=500)&&attempt+1<attempts){await new Promise(r=>setTimeout(r,500*(attempt+1)));continue;}
    if(!response.ok)throw new Error(`接口请求失败 HTTP ${response.status}`);
    try{return await response.json();}catch{throw new Error('接口未返回有效JSON');}
  }
  throw new Error('接口重试已达上限');
}
