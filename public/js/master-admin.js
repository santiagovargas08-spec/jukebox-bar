'use strict';
const $=id=>document.getElementById(id);
const BARS_PAGE_SIZE=25;
const AUDIT_PAGE_SIZE=50;
let barsOffset=0;
let auditOffset=0;
function setLoggedIn(value){$('login').classList.toggle('hidden',value);$('app').classList.toggle('hidden',!value)}
async function api(path,options={}){
  const headers={
    'Content-Type':'application/json',
    ...(options.headers||{})
  };
  const response=await fetch(
    `/api/public/master-admin${path}`,
    {
      ...options,
      headers,
      credentials:'same-origin'
    }
  );
  const data=await response.json().catch(()=>({
    ok:false,
    error:'Respuesta inválida'
  }));

  if(!response.ok||!data.ok){
    const error=new Error(
      data.error||'Error de servidor'
    );
    error.status=response.status;

    if(response.status===401){
      setLoggedIn(false);
    }

    throw error;
  }

  return data.data;
}
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function renderStats(s){
  const container=$('stats');
  container.replaceChildren();

  for(const [label,value] of Object.entries({
    Total:s.total,
    Activos:s.active,
    Inactivos:s.inactive,
    Pruebas:s.trial,
    'Licencias activas':s.activeLicense,
    Expiradas:s.expired,
    Suspendidas:s.suspended
  })){
    const card=document.createElement('div');
    card.className='stat';

    const muted=document.createElement('span');
    muted.className='muted';
    muted.textContent=label;

    const strong=document.createElement('strong');
    strong.textContent=String(value??0);

    card.append(muted,strong);
    container.appendChild(card);
  }
}
function createActionButton(text,className=''){
  const button=document.createElement('button');
  button.type='button';
  button.textContent=text;
  if(className)button.className=className;
  return button;
}

function licenseButton(b){
  const status=b.license?.status||'NONE';
  const button=createActionButton(
    status==='SUSPENDED'
      ?'Reactivar licencia'
      :status==='ACTIVE'
        ?'Suspender licencia'
        :'Activar suscripción',
    status==='SUSPENDED'
      ?'secondary'
      :status==='ACTIVE'
        ?'danger'
        :''
  );

  button.dataset.licenseAction=
    status==='SUSPENDED'
      ?'reactivate'
      :status==='ACTIVE'
        ?'suspend'
        :'activate';

  button.dataset.id=String(b.id);
  return button;
}

function renderBars(bars){
  const container=$('bars');
  container.replaceChildren();

  if(!bars.length){
    const empty=document.createElement('p');
    empty.className='muted';
    empty.textContent='Todavía no hay bares. Crea el primero desde este panel.';
    container.appendChild(empty);
    return;
  }

  for(const b of bars){
    const article=document.createElement('article');
    article.className='bar';

    const head=document.createElement('div');
    head.className='bar-head';

    const info=document.createElement('div');
    const title=document.createElement('h3');
    title.textContent=String(b.name||'');

    const identity=document.createElement('div');
    identity.className='muted';
    identity.textContent=`ID ${b.id} · ${b.slug||''}`;

    const badge=document.createElement('span');
    badge.className='badge';
    badge.textContent=
      `${b.active?'ACTIVO':'INACTIVO'} · ${b.license?.status||'SIN LICENCIA'}`;

    info.append(title,identity,badge);

    const tableActions=document.createElement('div');
    tableActions.className='table-actions';

    const edit=createActionButton('Editar','secondary');
    edit.dataset.edit=String(b.id);
    edit.dataset.name=String(b.name||'');
    edit.dataset.display=String(b.settings?.displayName||'');
    edit.dataset.welcome=String(b.settings?.welcomeMessage||'');

    const toggle=createActionButton(
      b.active?'Desactivar':'Activar',
      'secondary'
    );
    toggle.dataset.toggle=String(b.id);
    toggle.dataset.active=String(!b.active);

    const admin=createActionButton('Crear BAR_ADMIN');
    admin.dataset.admin=String(b.id);

    tableActions.append(edit,toggle,admin);
    head.append(info,tableActions);

    const urls=document.createElement('div');
    urls.className='urls';

    for(const [label,url] of [
      ['Cliente',b.urls?.cliente],
      ['Bar',b.urls?.bar],
      ['Admin',b.urls?.admin]
    ]){
      const anchor=document.createElement('a');
      anchor.href=String(url||'#');
      anchor.target='_blank';
      anchor.rel='noopener';
      anchor.textContent=`${label}: ${String(url||'')}`;
      urls.appendChild(anchor);
    }

    const licenseBox=document.createElement('div');
    licenseBox.className='license-box';

    const licenseTitle=document.createElement('strong');
    licenseTitle.textContent='Licencia';

    const licenseMeta=document.createElement('div');
    licenseMeta.className='muted';
    licenseMeta.textContent=
      `Estado: ${b.license?.status||'SIN LICENCIA'} · Plan: ${b.license?.plan||'—'} · Vence: ${b.license?.expiresAt||b.license?.trialEndsAt||'—'}`;

    const licenseActions=document.createElement('div');
    licenseActions.className='license-actions';
    licenseActions.appendChild(licenseButton(b));

    const paymentsButton=createActionButton(
      'Ver pagos',
      'secondary'
    );
    paymentsButton.dataset.payments=String(b.id);
    licenseActions.appendChild(paymentsButton);

    const payments=document.createElement('div');
    payments.id=`payments-${b.id}`;
    payments.className='payment-list hidden';

    licenseBox.append(
      licenseTitle,
      licenseMeta,
      licenseActions,
      payments
    );

    const qrRow=document.createElement('div');
    qrRow.className='row qr-row';

    const qr=document.createElement('img');
    qr.className='qr';
    qr.src=String(b.urls?.qr||'');
    qr.alt=`QR de ${String(b.name||'')}`;
    qr.loading='lazy';

    const qrInfo=document.createElement('div');
    const qrTitle=document.createElement('p');
    const qrStrong=document.createElement('strong');
    qrStrong.textContent='QR del cliente';
    qrTitle.appendChild(qrStrong);

    const qrHelp=document.createElement('p');
    qrHelp.className='muted';
    qrHelp.textContent='El QR apunta a la URL cliente real del bar.';

    const qrActions=document.createElement('div');
    qrActions.className='actions';

    const openAnchor=document.createElement('a');
    openAnchor.href=String(b.urls?.qr||'#');
    openAnchor.target='_blank';
    openAnchor.rel='noopener';
    openAnchor.appendChild(
      createActionButton('Abrir QR','secondary')
    );

    const downloadAnchor=document.createElement('a');
    downloadAnchor.href=String(b.urls?.qr||'#');
    downloadAnchor.download=`qr-${b.slug||'bar'}.png`;
    downloadAnchor.appendChild(
      createActionButton('Descargar QR','secondary')
    );

    const copy=createActionButton(
      'Copiar URL cliente',
      'secondary'
    );
    copy.dataset.copy=String(b.urls?.cliente||'');

    qrActions.append(
      openAnchor,
      downloadAnchor,
      copy
    );
    qrInfo.append(qrTitle,qrHelp,qrActions);
    qrRow.append(qr,qrInfo);

    article.append(
      head,
      urls,
      licenseBox,
      qrRow
    );
    container.appendChild(article);
  }

  document.querySelectorAll('[data-edit]').forEach(btn=>btn.onclick=()=>editBar(btn.dataset.id,btn.dataset.name,btn.dataset.display,btn.dataset.welcome));
  document.querySelectorAll('[data-toggle]').forEach(btn=>btn.onclick=async()=>{try{await api(`/bars/${btn.dataset.toggle}/active`,{method:'PATCH',body:JSON.stringify({active:btn.dataset.active==='true'})});await load()}catch(e){await AdminDialog.message('No se pudo cambiar el estado',e.message)}});
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
      await AdminDialog.message('Administrador creado', `BAR_ADMIN creado: ${a.email}`);
      await load();
    }catch(e){await AdminDialog.message('No se pudo crear el administrador',e.message)}
  });
  document.querySelectorAll('[data-license-action]').forEach(btn=>btn.onclick=()=>licenseAction(btn.dataset.id,btn.dataset.licenseAction));
  document.querySelectorAll('[data-payments]').forEach(btn=>btn.onclick=()=>loadPayments(btn.dataset.payments));
  document.querySelectorAll('[data-copy]').forEach(btn=>btn.onclick=async()=>{
    try{
      await navigator.clipboard.writeText(btn.dataset.copy);
      await AdminDialog.message('URL copiada', 'La URL del cliente se copió al portapapeles.');
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
  }catch(e){await AdminDialog.message('No se pudo editar el bar',e.message)}
}
async function licenseAction(id,action){
  try{
    if(action==='suspend'){
      if(!await AdminDialog.confirm(
        'Suspender licencia',
        '¿Seguro que deseas suspender la licencia de este bar?',
        { confirmText: 'Suspender', danger: true }
      ))return;
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
  }catch(e){await AdminDialog.message('No se pudo actualizar la licencia',e.message)}
}
async function loadPayments(id){
  const box=$(`payments-${id}`);
  if(!box)return;

  try{
    const payments=await api(`/bars/${id}/payments`);
    box.classList.remove('hidden');
    box.replaceChildren();

    if(!payments.length){
      const empty=document.createElement('div');
      empty.className='muted';
      empty.textContent='No hay pagos registrados.';
      box.appendChild(empty);
      return;
    }

    for(const payment of payments){
      const row=document.createElement('div');
      row.className='payment';

      const strong=document.createElement('strong');
      strong.textContent=`${payment.amount} ${payment.currency}`;

      const details=document.createTextNode(
        ` · ${payment.plan} · ${payment.method}`
      );

      const br=document.createElement('br');
      const meta=document.createElement('span');
      meta.className='muted';
      meta.textContent=
        `${payment.paidAt}${payment.reference?` · Ref: ${payment.reference}`:''}`;

      row.append(strong,details,br,meta);
      box.appendChild(row);
    }
  }catch(e){
    await AdminDialog.message(
      'No se pudieron cargar los pagos',
      e.message
    );
  }
}
function renderBarsPager(page){
  const total=Number(page.total)||0;
  const offset=Number(page.offset)||0;
  const limit=Number(page.limit)||BARS_PAGE_SIZE;
  const start=total===0?0:offset+1;
  const end=Math.min(offset+page.items.length,total);

  $('bars-page').textContent=total===0?'0 bares':`${start}–${end} de ${total}`;
  $('bars-prev').disabled=offset<=0;
  $('bars-next').disabled=offset+limit>=total;
}

async function loadBars(){
  const page=await api(`/bars?limit=${BARS_PAGE_SIZE}&offset=${barsOffset}`);

  if(barsOffset>0&&page.items.length===0&&page.total>0){
    barsOffset=Math.max(0,barsOffset-BARS_PAGE_SIZE);
    return loadBars();
  }

  renderBars(page.items);
  renderBarsPager(page);
}


function renderAudit(page){
  const items=Array.isArray(page.items)?page.items:[];
  const total=Number(page.total)||0;
  const offset=Number(page.offset)||0;
  const limit=Number(page.limit)||AUDIT_PAGE_SIZE;
  const start=total===0?0:offset+1;
  const end=Math.min(offset+items.length,total);

  $('audit-page').textContent=total===0?'0 eventos':`${start}–${end} de ${total}`;
  $('audit-prev').disabled=offset<=0;
  $('audit-next').disabled=offset+limit>=total;

  const list=$('audit-list');
  list.replaceChildren();

  if(!items.length){
    const empty=document.createElement('p');
    empty.className='muted';
    empty.textContent='Todavía no hay eventos de auditoría.';
    list.appendChild(empty);
    return;
  }

  for(const item of items){
    const article=document.createElement('article');
    article.className='audit-item';

    const main=document.createElement('div');
    main.className='audit-main';

    const action=document.createElement('strong');
    action.textContent=String(item.action||'');

    const created=document.createElement('span');
    created.className='muted';
    created.textContent=`· ${String(item.createdAt||'')}`;

    main.append(action,created);

    const meta=document.createElement('div');
    meta.className='audit-meta';

    const values=[
      `Actor: ${item.actorEmail||'—'}`,
      `Rol: ${item.actorRole||'—'}`,
      `Bar: ${item.barId??'—'}`,
      `Entidad: ${item.entityType||'—'} ${item.entityId||''}`,
      `Request: ${item.requestId||'—'}`
    ];

    for(const value of values){
      const span=document.createElement('span');
      span.textContent=String(value);
      meta.appendChild(span);
    }

    article.append(main,meta);
    list.appendChild(article);
  }
}

async function loadAudit(){
  const page=await api(
    `/audit?limit=${AUDIT_PAGE_SIZE}&offset=${auditOffset}`
  );

  if(
    auditOffset>0 &&
    page.items.length===0 &&
    page.total>0
  ){
    auditOffset=Math.max(
      0,
      auditOffset-AUDIT_PAGE_SIZE
    );
    return loadAudit();
  }

  renderAudit(page);
}

async function load(){
  const [s,me]=await Promise.all([
    api('/dashboard'),
    api('/me'),
    loadBars(),
    loadAudit()
  ]);
  renderStats(s);
  $('who').textContent=`Sesión: ${me.email} · SUPER_ADMIN`;
}
$('loginForm').onsubmit=async e=>{e.preventDefault();$('loginError').textContent='';try{await api('/login',{method:'POST',body:JSON.stringify({email:$('email').value,password:$('password').value})});setLoggedIn(true);await load()}catch(err){$('loginError').textContent=err.message}};
$('createForm').onsubmit=async e=>{e.preventDefault();$('createMessage').textContent='';try{const b=await api('/bars',{method:'POST',body:JSON.stringify({name:$('barName').value,displayName:$('displayName').value,welcomeMessage:$('welcomeMessage').value})});$('createMessage').className='ok';$('createMessage').textContent=`BAR CREADO · ID ${b.id} · slug ${b.slug}`;e.target.reset();barsOffset=0;await load()}catch(err){$('createMessage').className='error';$('createMessage').textContent=err.message}};
$('bars-prev').onclick=async()=>{if(barsOffset<=0)return;barsOffset=Math.max(0,barsOffset-BARS_PAGE_SIZE);try{await loadBars()}catch(e){await AdminDialog.message('No se pudieron cargar los bares',e.message)}};
$('bars-next').onclick=async()=>{barsOffset+=BARS_PAGE_SIZE;try{await loadBars()}catch(e){barsOffset=Math.max(0,barsOffset-BARS_PAGE_SIZE);await AdminDialog.message('No se pudieron cargar los bares',e.message)}};
$('audit-prev').onclick=async()=>{if(auditOffset<=0)return;auditOffset=Math.max(0,auditOffset-AUDIT_PAGE_SIZE);try{await loadAudit()}catch(e){await AdminDialog.message('No se pudo cargar la auditoría',e.message)}};
$('audit-next').onclick=async()=>{auditOffset+=AUDIT_PAGE_SIZE;try{await loadAudit()}catch(e){auditOffset=Math.max(0,auditOffset-AUDIT_PAGE_SIZE);await AdminDialog.message('No se pudo cargar la auditoría',e.message)}};
$('logout').onclick=async()=>{try{await api('/logout',{method:'POST'})}catch(e){console.warn('No se pudo revocar la sesión en servidor:',e.message)}finally{setLoggedIn(false)}};
(async()=>{
  try{
    await load();
    setLoggedIn(true);
  }catch(e){
    if(e.status===401){
      setLoggedIn(false);
      return;
    }

    setLoggedIn(true);
    await AdminDialog.message(
      'No se pudo cargar el panel',
      e.message||'Error de conexión.'
    );
  }
})();
