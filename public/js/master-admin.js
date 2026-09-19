'use strict';
const $=id=>document.getElementById(id);
function setLoggedIn(value){$('login').classList.toggle('hidden',value);$('app').classList.toggle('hidden',!value)}
async function api(path,options={}){const headers={'Content-Type':'application/json',...(options.headers||{})};const r=await fetch(`/api/public/master-admin${path}`,{...options,headers,credentials:'same-origin'});const data=await r.json().catch(()=>({ok:false,error:'Respuesta inválida'}));if(!r.ok||!data.ok)throw new Error(data.error||'Error de servidor');return data.data}
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function renderStats(s){$('stats').innerHTML=Object.entries({Total:s.total,Activos:s.active,Inactivos:s.inactive,Pruebas:s.trial,'Licencias activas':s.activeLicense,Expiradas:s.expired,Suspendidas:s.suspended}).map(([k,v])=>`<div class="stat"><span class="muted">${k}</span><strong>${v}</strong></div>`).join('')}
function licenseButtons(b){const status=b.license?.status||'NONE';if(status==='SUSPENDED')return `<button class="secondary" data-license-action="reactivate" data-id="${b.id}">Reactivar licencia</button>`;if(status==='ACTIVE')return `<button class="danger" data-license-action="suspend" data-id="${b.id}">Suspender licencia</button>`;return `<button data-license-action="activate" data-id="${b.id}">Activar suscripción</button>`;}
function renderBars(bars){
  $('bars').innerHTML=bars.length?bars.map(b=>`<article class="bar">
    <div class="bar-head"><div><h3>${escapeHtml(b.name)}</h3><div class="muted">ID ${b.id} · ${escapeHtml(b.slug)}</div><span class="badge">${b.active?'ACTIVO':'INACTIVO'} · ${escapeHtml(b.license?.status||'SIN LICENCIA')}</span></div>
    <div class="table-actions"><button class="secondary" data-edit="${b.id}" data-name="${escapeHtml(b.name)}" data-display="${escapeHtml(b.settings?.displayName||'')}" data-welcome="${escapeHtml(b.settings?.welcomeMessage||'')}">Editar</button><button class="secondary" data-toggle="${b.id}" data-active="${!b.active}">${b.active?'Desactivar':'Activar'}</button><button data-admin="${b.id}">Crear BAR_ADMIN</button></div></div>
    <div class="urls"><a href="${escapeHtml(b.urls.cliente)}" target="_blank" rel="noopener">Cliente: ${escapeHtml(b.urls.cliente)}</a><a href="${escapeHtml(b.urls.bar)}" target="_blank" rel="noopener">Bar: ${escapeHtml(b.urls.bar)}</a><a href="${escapeHtml(b.urls.admin)}" target="_blank" rel="noopener">Admin: ${escapeHtml(b.urls.admin)}</a></div>
    <div class="license-box"><strong>Licencia</strong><div class="muted">Estado: ${escapeHtml(b.license?.status||'SIN LICENCIA')} · Plan: ${escapeHtml(b.license?.plan||'—')} · Vence: ${escapeHtml(b.license?.expiresAt||b.license?.trialEndsAt||'—')}</div><div class="license-actions">${licenseButtons(b)}<button class="secondary" data-payments="${b.id}">Ver pagos</button></div><div id="payments-${b.id}" class="payment-list hidden"></div></div>
    <div class="row" style="margin-top:12px"><img class="qr" src="${escapeHtml(b.urls.qr)}" alt="QR de ${escapeHtml(b.name)}"><div><p><strong>QR del cliente</strong></p><p class="muted">El QR apunta a la URL cliente real del bar.</p><div class="actions"><a href="${escapeHtml(b.urls.qr)}" target="_blank" rel="noopener"><button type="button" class="secondary">Abrir QR</button></a><a href="${escapeHtml(b.urls.qr)}" download="qr-${escapeHtml(b.slug)}.png"><button type="button" class="secondary">Descargar QR</button></a><button type="button" class="secondary" data-copy="${escapeHtml(b.urls.cliente)}">Copiar URL cliente</button></div></div></div>
  </article>`).join(''):'<p class="muted">Todavía no hay bares. Crea el primero desde este panel.</p>';

  document.querySelectorAll('[data-edit]').forEach(btn=>btn.onclick=()=>editBar(btn.dataset.id,btn.dataset.name,btn.dataset.display,btn.dataset.welcome));
  document.querySelectorAll('[data-toggle]').forEach(btn=>btn.onclick=async()=>{try{await api(`/bars/${btn.dataset.toggle}/active`,{method:'PATCH',body:JSON.stringify({active:btn.dataset.active==='true'})});await load()}catch(e){alert(e.message)}});
  document.querySelectorAll('[data-admin]').forEach(btn=>btn.onclick=async()=>{
    const values=await AdminDialog.ask('Crear BAR_ADMIN',[
      {name:'email',label:'Correo',type:'email',required:true,autocomplete:'username'},
      {name:'displayName',label:'Nombre del administrador',value:'Administrador del bar',required:true},
      {name:'password',label:'Contraseña',type:'password',required:true,autocomplete:'new-password'}
    ]);
    if(!values)return;
    try{
      const a=await api(`/bars/${btn.dataset.admin}/admins`,{
        method:'POST',
        body:JSON.stringify(values)
      });
      alert(`BAR_ADMIN creado: ${a.email}`);
      await load();
    }catch(e){alert(e.message)}
  });
  document.querySelectorAll('[data-license-action]').forEach(btn=>btn.onclick=()=>licenseAction(btn.dataset.id,btn.dataset.licenseAction));
  document.querySelectorAll('[data-payments]').forEach(btn=>btn.onclick=()=>loadPayments(btn.dataset.payments));
  document.querySelectorAll('[data-copy]').forEach(btn=>btn.onclick=async()=>{
    try{
      await navigator.clipboard.writeText(btn.dataset.copy);
      alert('URL copiada.');
    }catch(e){
      const values=await AdminDialog.ask('Copiar URL',[
        {name:'url',label:'URL',value:btn.dataset.copy}
      ]);
      if(values?.url){
        try{await navigator.clipboard.writeText(values.url)}catch{}
      }
    }
  });
}
async function editBar(id,name,displayName,welcomeMessage){
  const values=await AdminDialog.ask('Editar bar',[
    {name:'name',label:'Nombre del bar',value:name,required:true},
    {name:'displayName',label:'Nombre mostrado',value:displayName||''},
    {name:'welcomeMessage',label:'Mensaje de bienvenida',value:welcomeMessage||''}
  ]);
  if(!values)return;
  try{
    await api(`/bars/${id}`,{method:'PUT',body:JSON.stringify(values)});
    await load();
  }catch(e){alert(e.message)}
}
async function licenseAction(id,action){
  try{
    if(action==='suspend'){
      if(!confirm('¿Suspender la licencia de este bar?'))return;
      await api(`/bars/${id}/license/suspend`,{method:'POST'});
    }else if(action==='reactivate'){
      await api(`/bars/${id}/license/reactivate`,{method:'POST'});
    }else if(action==='activate'){
      const values=await AdminDialog.ask('Activar suscripción',[
        {name:'plan',label:'Plan',type:'select',value:'MONTHLY',options:['MONTHLY','QUARTERLY']},
        {name:'amount',label:'Monto del pago',type:'number',value:'0',min:0,step:'0.01',required:true},
        {name:'currency',label:'Moneda',type:'select',value:'USD',options:['USD','COP']},
        {name:'method',label:'Método',type:'select',value:'TRANSFER',options:['TRANSFER','CASH']},
        {name:'reference',label:'Referencia',value:''},
        {name:'notes',label:'Notas',value:''}
      ]);
      if(!values)return;
      await api(`/bars/${id}/license/activate`,{
        method:'POST',
        body:JSON.stringify(values)
      });
    }
    await load();
  }catch(e){alert(e.message)}
}
async function loadPayments(id){const box=$(`payments-${id}`);if(!box)return;try{const payments=await api(`/bars/${id}/payments`);box.classList.remove('hidden');box.innerHTML=payments.length?payments.map(p=>`<div class="payment"><strong>${escapeHtml(p.amount)} ${escapeHtml(p.currency)}</strong> · ${escapeHtml(p.plan)} · ${escapeHtml(p.method)}<br><span class="muted">${escapeHtml(p.paidAt)}${p.reference?' · Ref: '+escapeHtml(p.reference):''}</span></div>`).join(''):'<div class="muted">No hay pagos registrados.</div>';}catch(e){alert(e.message)}}
async function load(){const [s,bars,me]=await Promise.all([api('/dashboard'),api('/bars'),api('/me')]);renderStats(s);renderBars(bars);$('who').textContent=`Sesión: ${me.email} · SUPER_ADMIN`}
$('loginForm').onsubmit=async e=>{e.preventDefault();$('loginError').textContent='';try{await api('/login',{method:'POST',body:JSON.stringify({email:$('email').value,password:$('password').value})});setLoggedIn(true);await load()}catch(err){$('loginError').textContent=err.message}};
$('createForm').onsubmit=async e=>{e.preventDefault();$('createMessage').textContent='';try{const b=await api('/bars',{method:'POST',body:JSON.stringify({name:$('barName').value,displayName:$('displayName').value,welcomeMessage:$('welcomeMessage').value})});$('createMessage').className='ok';$('createMessage').textContent=`BAR CREADO · ID ${b.id} · slug ${b.slug}`;e.target.reset();await load()}catch(err){$('createMessage').className='error';$('createMessage').textContent=err.message}};
$('logout').onclick=async()=>{try{await api('/logout',{method:'POST'})}catch(e){console.warn('No se pudo revocar la sesión en servidor:',e.message)}finally{setLoggedIn(false)}};
(async()=>{try{await load();setLoggedIn(true)}catch(e){setLoggedIn(false)}})();
