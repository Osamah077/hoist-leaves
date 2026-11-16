(function(){
  "use strict";
  var TODAY = new Date(); TODAY.setHours(0,0,0,0);
  var $=function(id){ return document.getElementById(id); };
  var rowsEl=$('rows'), emptyEl=$('empty'), tilesEl=$('tiles'), countEl=$('count'),
      qEl=$('q'), locEl=$('loc'), stEl=$('st');
  var EMP=[], LV=[], CHG=[], sortKey='bal', sortDir=1, ready=false, openNid=null, editNid=null;
  var API = window.hoist;

  var TYPES=[
    {k:'اعتيادية (سنوية)', d:true},
    {k:'اضطرارية', d:true},
    {k:'مرضية', d:false},
    {k:'وضع', d:false},
    {k:'زواج', d:false},
    {k:'وفاة', d:false},
    {k:'بدون أجر', d:false},
    {k:'أخرى', d:false}
  ];
  function deducts(t){ for(var i=0;i<TYPES.length;i++) if(TYPES[i].k===t) return TYPES[i].d; return false; }

  // ===== التخزين =====
  var saveTimer=null;
  function persist(){
    clearTimeout(saveTimer);
    saveTimer=setTimeout(function(){
      API.save({version:1, savedAt:new Date().toISOString(), employees:EMP, leaves:LV, changes:CHG.slice(-300)})
        .catch(function(){ toast('تعذّر حفظ البيانات على الجهاز'); });
    },150);
  }
  function logChange(act,kind,label,detail){
    CHG.push({id:'c-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
      at:new Date().toISOString(), act:act, kind:kind, label:label||'', detail:detail||''});
    renderChanges();
  }
  function toast(msg){
    var t=$('toast'); t.textContent=msg; t.classList.add('on');
    clearTimeout(t._h); t._h=setTimeout(function(){ t.classList.remove('on'); },3200);
  }

  $('asof').textContent = fmt(TODAY);
  $('l-type').innerHTML = TYPES.map(function(t){
    return '<option value="'+esc(t.k)+'">'+esc(t.k)+(t.d?'':' — لا تُخصم')+'</option>'; }).join('');

  function fmt(d){ if(!(d instanceof Date)||isNaN(d))return '—';
    return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear(); }
  function parse(s){ if(!s) return null; var d=new Date(s+'T00:00:00'); return isNaN(d)?null:d; }
  function addDays(d,n){ var x=new Date(d.getTime()); x.setDate(x.getDate()+n); return x; }
  function addYears(d,n){ var x=new Date(d.getTime()); x.setFullYear(x.getFullYear()+n); return x; }
  function round1(n){ return Math.round(n*10)/10; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function digits(s){ return String(s==null?'':s).replace(/[٠-٩]/g,function(c){ return String(c.charCodeAt(0)-1632); })
    .replace(/[۰-۹]/g,function(c){ return String(c.charCodeAt(0)-1776); }); }
  function num(v,def){ var n=Number(digits(v).replace(/[^\d.\-]/g,'')); return (String(v).trim()===''||isNaN(n))?def:n; }

  function norm(s){
    return String(s==null?'':s)
      .replace(/[ً-ْـ]/g,'')
      .replace(/[آأإٱ]/g,'ا')
      .replace(/ة/g,'ه').replace(/ى/g,'ي')
      .replace(/ؤ/g,'و').replace(/ئ/g,'ي')
      .replace(/[\s‏‎_\-()\/.:]/g,'').toLowerCase();
  }
  function hit(r,q){
    var hay=norm(r.name)+norm(r.nid)+norm(r.job)+norm(r.loc);
    var parts=q.split(/\s+/).filter(Boolean);
    for(var i=0;i<parts.length;i++){ if(hay.indexOf(norm(parts[i]))<0) return false; }
    return true;
  }

  function service(start){
    if(!start) return {y:0,m:0,txt:'—'};
    var y=TODAY.getFullYear()-start.getFullYear(), m=TODAY.getMonth()-start.getMonth();
    if(TODAY.getDate()<start.getDate()) m--;
    if(m<0){ y--; m+=12; }
    if(y<0) return {y:0,m:0,txt:'لم تبدأ'};
    var p=[]; if(y) p.push(y+' سنة'); if(m) p.push(m+' شهر');
    return {y:y,m:m,txt:p.length?p.join(' و'):'أقل من شهر'};
  }
  function accrued(start, base){
    if(!start || start>TODAY) return 0;
    var total=0;
    for(var y=0;y<80;y++){
      var a=addYears(start,y), b=addYears(start,y+1);
      if(a>=TODAY) break;
      var ent=(y>=5)?Math.max(30,base):base;
      total += (b<=TODAY) ? ent : ent*((TODAY-a)/(b-a));
    }
    return total;
  }
  function usedOf(nid){
    var s=0;
    for(var i=0;i<LV.length;i++){ if(LV[i].nid===nid && deducts(LV[i].type)) s+=Number(LV[i].days)||0; }
    return s;
  }
  function compute(r){
    var start=parse(r.start), base=Number(r.ent)||21;
    var opening=Number(r.used)||0, logged=usedOf(r.nid), used=round1(opening+logged);
    var svc=service(start), ent=(svc.y>=5?Math.max(30,base):base), acc=round1(accrued(start,base));
    var bal=round1(acc-used);
    return {start:start,svc:svc,ent:ent,acc:acc,used:used,opening:opening,logged:round1(logged),bal:bal,
            state: bal<0?'crit':(bal>=ent?'warn':'ok'),
            pct: acc>0?Math.max(0,Math.min(100,(used/acc)*100)):0,
            svcSort:(svc.y*12+svc.m)};
  }

  function tiles(){
    var acc=0,used=0,bal=0,five=0,over=0;
    EMP.forEach(function(r){ var c=compute(r); acc+=c.acc; used+=c.used; bal+=c.bal;
      if(c.svc.y>=5) five++; if(c.bal<0) over++; });
    var t=[['عدد الموظفين',EMP.length,'',false],
           ['المستحق تراكميًا',round1(acc),'يوم',true],
           ['المستخدم',round1(used),'يوم',false],
           ['الرصيد المتبقي',round1(bal),'يوم',true],
           ['إجازات مسجّلة',LV.length,'سجل',false],
           ['تجاوزوا 5 سنوات',five,'رصيدهم 30 يومًا',false],
           ['تجاوزوا رصيدهم',over,'يحتاج معالجة',false]];
    tilesEl.innerHTML=t.map(function(x){
      return '<div class="tile'+(x[3]?' hi':'')+'"><div class="k">'+x[0]+'</div><div class="v">'+x[1]+'</div><div class="u">'+x[2]+'</div></div>';
    }).join('');
  }

  function histRow(nid){
    var mine=LV.filter(function(l){ return l.nid===nid; })
      .sort(function(a,b){ return (b.start||'').localeCompare(a.start||''); });
    var inner = mine.length ? mine.map(function(l){
      var s=parse(l.start), e=s?addDays(s,Math.max(1,Math.ceil(Number(l.days)||1))-1):null;
      return '<div class="hl">'+
        '<span class="tag'+(deducts(l.type)?' ded':'')+'">'+esc(l.type)+'</span>'+
        '<b>'+esc(l.days)+' يوم</b>'+
        '<span class="d">'+fmt(s)+(e&&(Number(l.days)||1)>1?' — '+fmt(e):'')+'</span>'+
        (l.note?'<span class="d">· '+esc(l.note)+'</span>':'')+
        '<button class="btn tiny danger" data-dl="'+esc(l.id)+'" type="button">حذف</button>'+
      '</div>';
    }).join('') : '<div class="hl"><span class="d">لا توجد إجازات مسجّلة لهذا الموظف.</span></div>';
    return '<tr class="hist"><td colspan="12"><h4>سجل إجازات الموظف</h4>'+inner+'</td></tr>';
  }

  function render(){
    var q=qEl.value.trim(), fl=locEl.value, fs=stEl.value, list=EMP.slice();

    var locs=[]; EMP.forEach(function(r){ if(r.loc && locs.indexOf(r.loc)<0) locs.push(r.loc); });
    locs.sort(function(a,b){ return a.localeCompare(b,'ar'); }); var cur=locEl.value;
    locEl.innerHTML='<option value="">كل المواقع</option>'+locs.map(function(l){
      return '<option value="'+esc(l)+'">'+esc(l)+'</option>';}).join('');
    locEl.value = locs.indexOf(cur)>=0?cur:'';

    if(q) list=list.filter(function(r){ return hit(r,q); });
    if(fl) list=list.filter(function(r){ return r.loc===fl; });
    if(fs) list=list.filter(function(r){ return compute(r).state===fs; });

    list.sort(function(a,b){
      var ca=compute(a), cb=compute(b), x, y;
      if(['name','job','loc','nid'].indexOf(sortKey)>=0){
        return String(a[sortKey]||'').localeCompare(String(b[sortKey]||''),'ar')*sortDir; }
      if(sortKey==='start'){ x=ca.start?ca.start.getTime():0; y=cb.start?cb.start.getTime():0; }
      else if(sortKey==='svc'){ x=ca.svcSort; y=cb.svcSort; }
      else { x=ca[sortKey]; y=cb[sortKey]; }
      return (x-y)*sortDir;
    });

    tiles();
    countEl.textContent = list.length===EMP.length ? EMP.length+' موظف' : list.length+' من '+EMP.length+' موظف';

    var sel=$('l-emp'), keep=sel.value;
    sel.innerHTML='<option value="">— اختر الموظف —</option>'+
      EMP.slice().sort(function(a,b){ return String(a.name||'').localeCompare(String(b.name||''),'ar'); })
        .map(function(r){ return '<option value="'+esc(r.nid)+'">'+esc(r.name)+' — '+esc(r.nid)+'</option>'; }).join('');
    sel.value=keep;

    if(!list.length){
      rowsEl.innerHTML=''; emptyEl.hidden=false;
      emptyEl.innerHTML = EMP.length
        ? '<b>لا نتائج مطابقة</b>جرّب كلمة بحث أخرى أو أعد ضبط عوامل التصفية.'
        : (ready?'<b>السجل فارغ</b>استورد بياناتك من زر «استيراد البيانات» (Excel أو CSV)، أو أضف أول موظف يدويًا.':'<b>جارٍ تحميل السجل…</b>لحظات.');
      return;
    }
    emptyEl.hidden=true;

    rowsEl.innerHTML = list.map(function(r){
      var c=compute(r);
      var pill = c.state==='crit'?'<span class="pill p-crit">تجاوز</span>'
               : c.state==='warn'?'<span class="pill p-warn">مرتفع</span>'
               : '<span class="pill p-ok">متاح</span>';
      var tr='<tr class="emp" data-nid="'+esc(r.nid)+'">'+
        '<td class="name">'+esc(r.name)+'</td>'+
        '<td class="num">'+esc(r.nid)+'</td>'+
        '<td>'+esc(r.job||'—')+'</td>'+
        '<td>'+esc(r.loc||'—')+'</td>'+
        (c.start?'<td class="num">'+fmt(c.start)+'</td>':'<td><span class="pill p-crit">ناقص</span></td>')+
        '<td>'+esc(c.svc.txt)+'</td>'+
        '<td class="num">'+c.ent+'</td>'+
        '<td class="num">'+c.acc+'</td>'+
        '<td class="num">'+c.used+'</td>'+
        '<td class="num">'+c.bal+' '+pill+'</td>'+
        '<td><div class="meter"><i style="width:'+c.pct.toFixed(0)+'%"></i></div></td>'+
        '<td><div class="acts"><button class="btn tiny ghost" data-edit="'+esc(r.nid)+'" type="button">تعديل</button>'+
        '<button class="btn tiny danger" data-del="'+esc(r.nid)+'" type="button">حذف</button></div></td></tr>';
      return tr + (openNid===r.nid ? histRow(r.nid) : '');
    }).join('');
  }

  // ===== سجل التعديلات =====
  function arAgo(n,one,two,few,many){
    if(n===1) return 'قبل '+one; if(n===2) return 'قبل '+two;
    if(n<=10) return 'قبل '+n+' '+few; return 'قبل '+n+' '+many;
  }
  function relTime(iso){
    var d=new Date(iso); if(isNaN(d)) return '';
    var sec=Math.floor((Date.now()-d.getTime())/1000);
    if(sec<60) return 'قبل لحظات';
    if(sec<3600) return arAgo(Math.floor(sec/60),'دقيقة','دقيقتين','دقائق','دقيقة');
    if(sec<86400) return arAgo(Math.floor(sec/3600),'ساعة','ساعتين','ساعات','ساعة');
    var dd=Math.floor(sec/86400);
    if(dd<30) return arAgo(dd,'يوم','يومين','أيام','يومًا');
    return fmt(d);
  }
  function daysLabel(n){
    n=Number(n)||0;
    if(n!==Math.floor(n)) return n+' يوم';
    if(n===1) return 'يوم واحد'; if(n===2) return 'يومان';
    if(n<=10) return n+' أيام'; return n+' يومًا';
  }
  var ACTW={add:'إضافة',edit:'تعديل',del:'حذف',imp:'استيراد'};
  var KINDW={emp:'الموظف',leave:'إجازة لـ',file:'ملف'};
  function renderChanges(){
    var box=$('chgList'), panel=$('chgPanel');
    var list=CHG.slice().sort(function(a,b){ return String(b.at||'').localeCompare(String(a.at||'')); }).slice(0,20);
    if(!list.length){ panel.hidden=true; return; }
    panel.hidden=false;
    box.innerHTML=list.map(function(c){
      var kw=(KINDW[c.kind]||'');
      return '<div class="chgrow"><span class="chgwhat">'+esc(ACTW[c.act]||c.act)+' '+esc(kw)+(/ـ$/.test(kw)?'':' ')+
        '<b>'+esc(c.label)+'</b>'+(c.detail?' — '+esc(c.detail):'')+'</span>'+
        '<span class="chgwhen">'+esc(relTime(c.at))+'</span></div>';
    }).join('');
  }

  function calcPreview(){
    var nid=$('l-emp').value, box=$('l-calc');
    if(!nid){ box.textContent='اختر موظفًا لعرض أثر الإجازة على رصيده.'; return; }
    var r=EMP.filter(function(x){return x.nid===nid;})[0];
    if(!r){ box.textContent='—'; return; }
    var c=compute(r), days=Number($('l-days').value)||0, t=$('l-type').value, s=parse($('l-start').value);
    var e=s?addDays(s,Math.max(1,Math.ceil(days))-1):null;
    var after = deducts(t) ? round1(c.bal-days) : c.bal;
    box.innerHTML='الرصيد الحالي: <b>'+c.bal+'</b> يوم'+
      (s?' · من <b>'+fmt(s)+'</b> إلى <b>'+fmt(e)+'</b> · العودة <b>'+fmt(addDays(e,1))+'</b>':'')+
      '<br>'+(deducts(t)
        ? 'تُخصم <b>'+days+'</b> يوم · الرصيد بعدها: <b>'+after+'</b> يوم'+(after<0?' — <span style="color:var(--crit);font-weight:700">تجاوز الرصيد</span>':'')
        : '<b>'+esc(t)+'</b> لا تُخصم من الرصيد السنوي · يبقى <b>'+c.bal+'</b> يوم');
  }

  [qEl,locEl,stEl].forEach(function(el){ el.addEventListener('input',render); });
  ['l-emp','l-days','l-type','l-start'].forEach(function(id){
    $(id).addEventListener('input',calcPreview); $(id).addEventListener('change',calcPreview); });

  document.querySelectorAll('th[data-s]').forEach(function(th){
    th.addEventListener('click',function(){
      var k=th.getAttribute('data-s');
      if(sortKey===k) sortDir*=-1; else { sortKey=k; sortDir=(['name','job','loc'].indexOf(k)>=0)?1:-1; }
      render();
    });
  });

  $('toggleLeave').addEventListener('click',function(){
    var p=$('leavePanel'); p.hidden=!p.hidden;
    if(!p.hidden){ $('l-err').textContent=''; calcPreview(); $('l-emp').focus(); }
  });
  $('l-cancel').addEventListener('click',function(){ $('leavePanel').hidden=true; $('l-err').textContent=''; });

  function openEmpForm(r){
    editNid = r ? r.nid : null;
    $('addTitle').textContent = r ? 'تعديل بيانات الموظف' : 'إضافة موظف';
    $('f-name').value = r?r.name:''; $('f-nid').value = r?r.nid:''; $('f-nid').readOnly = !!r;
    $('f-job').value = r?(r.job||''):''; $('f-loc').value = r?(r.loc||''):'الرياض';
    $('f-start').value = r?(r.start||''):''; $('f-ent').value = r?(r.ent||21):21; $('f-used').value = r?(r.used||0):0;
    $('err').textContent=''; $('addPanel').hidden=false; $('f-name').focus();
    $('addPanel').scrollIntoView({behavior:'smooth',block:'start'});
  }
  $('toggleAdd').addEventListener('click',function(){
    if(!$('addPanel').hidden && !editNid){ $('addPanel').hidden=true; return; }
    openEmpForm(null);
  });
  $('cancel').addEventListener('click',function(){ $('addPanel').hidden=true; $('err').textContent=''; editNid=null; });

  // ===== حفظ إجازة =====
  $('l-save').addEventListener('click',function(){
    var err=$('l-err'); err.textContent='';
    var nid=$('l-emp').value, type=$('l-type').value,
        start=$('l-start').value, days=Number($('l-days').value)||0, note=$('l-note').value.trim();
    if(!nid){ err.textContent='اختر الموظف.'; return; }
    if(!parse(start)){ err.textContent='اختر تاريخ بداية الإجازة.'; return; }
    if(!(days>0)){ err.textContent='عدد الأيام يجب أن يكون أكبر من صفر.'; return; }
    var r=EMP.filter(function(x){return x.nid===nid;})[0];
    var id = nid+'-'+start.replace(/-/g,'')+'-'+Date.now().toString(36);
    LV.push({id:id,nid:nid,name:(r&&r.name)||'',type:type,start:start,days:days,note:note,at:new Date().toISOString()});
    openNid=nid; logChange('add','leave',(r&&r.name)||nid, type+' · '+daysLabel(days));
    render(); calcPreview(); persist();
    $('l-note').value=''; $('l-days').value=1; toast('حُفظت الإجازة');
  });

  // ===== حفظ موظف (إضافة/تعديل) =====
  $('save').addEventListener('click',function(){
    var v=function(id){ return $(id).value.trim(); }, err=$('err'); err.textContent='';
    var name=v('f-name'), nid=digits(v('f-nid')), job=v('f-job'), loc=v('f-loc'),
        start=v('f-start'), ent=Number(v('f-ent'))||21, used=Number(v('f-used'))||0;
    if(!name){ err.textContent='اكتب اسم الموظف.'; return; }
    if(!/^\d{10}$/.test(nid)){ err.textContent='رقم الهوية يجب أن يكون عشرة أرقام.'; return; }
    if(!editNid && EMP.some(function(r){return r.nid===nid;})){ err.textContent='هذا الرقم مسجّل بالفعل.'; return; }
    if(!parse(start)){ err.textContent='اختر تاريخ المباشرة.'; return; }
    if(parse(start)>TODAY){ err.textContent='تاريخ المباشرة في المستقبل.'; return; }
    var rec={nid:nid,name:name,job:job,loc:loc,start:start,ent:ent,used:used};
    if(editNid){
      EMP=EMP.map(function(r){ return r.nid===editNid?rec:r; });
      LV.forEach(function(l){ if(l.nid===nid) l.name=name; });
      logChange('edit','emp',name,job||'');
    } else { EMP.push(rec); logChange('add','emp',name,job||''); }
    editNid=null; $('addPanel').hidden=true; render(); persist(); toast('حُفظ الموظف');
  });

  // ===== نقرات الجدول =====
  rowsEl.addEventListener('click',function(e){
    var dl=e.target.closest('[data-dl]');
    if(dl){
      e.stopPropagation();
      if(dl.dataset.confirm){
        var lid=dl.getAttribute('data-dl');
        var gone=LV.filter(function(l){ return l.id===lid; })[0];
        LV=LV.filter(function(l){ return l.id!==lid; });
        logChange('del','leave',(gone&&gone.name)||'—', gone?(gone.type+' · '+daysLabel(gone.days)):'');
        render(); calcPreview(); persist();
      } else {
        dl.dataset.confirm='1'; dl.textContent='تأكيد';
        setTimeout(function(){ if(dl.isConnected){ delete dl.dataset.confirm; dl.textContent='حذف'; } },4000);
      }
      return;
    }
    var ed=e.target.closest('[data-edit]');
    if(ed){ e.stopPropagation();
      openEmpForm(EMP.filter(function(r){ return r.nid===ed.getAttribute('data-edit'); })[0]); return; }
    var b=e.target.closest('[data-del]');
    if(b){
      e.stopPropagation();
      if(b.dataset.confirm){
        var nid=b.getAttribute('data-del');
        var goneE=EMP.filter(function(r){ return r.nid===nid; })[0];
        EMP=EMP.filter(function(r){ return r.nid!==nid; });
        LV=LV.filter(function(l){ return l.nid!==nid; });
        if(openNid===nid) openNid=null;
        logChange('del','emp',(goneE&&goneE.name)||nid,'');
        render(); persist();
      } else {
        b.dataset.confirm='1'; b.textContent='تأكيد الحذف';
        setTimeout(function(){ if(b.isConnected){ delete b.dataset.confirm; b.textContent='حذف'; } },4000);
      }
      return;
    }
    var tr=e.target.closest('tr.emp');
    if(tr){ var n=tr.getAttribute('data-nid'); openNid = (openNid===n)?null:n; render(); }
  });

  // =========================================================
  // ===== الاستيراد =====
  // =========================================================
  var EMP_COLS={
    name:['الاسم','الاسم الرباعي','اسم الموظف','الموظف','الاسم الكامل','name','employee','employeename','fullname'],
    nid:['رقم الهوية','الهوية','رقم الهويه','رقم الإقامة','رقم الاقامة','الإقامة','السجل المدني','الهوية/الإقامة','رقم الهوية/الإقامة','nid','id','nationalid','iqama'],
    job:['المسمى الوظيفي','المسمى','الوظيفة','المهنة','job','title','jobtitle','position'],
    loc:['المقر','مقر العمل','الموقع','الفرع','المدينة','loc','location','branch','site'],
    start:['تاريخ المباشرة','المباشرة','تاريخ التعيين','تاريخ الالتحاق','تاريخ بداية العمل','تاريخ الانضمام','start','startdate','joiningdate','hiredate','joindate'],
    ent:['الرصيد السنوي','الاستحقاق السنوي','أيام الإجازة السنوية','ent','entitlement','annual'],
    used:['رصيد مستهلك سابق','الرصيد المستهلك','المستهلك','المستخدم','الأيام المستخدمة','used','consumed','taken']
  };
  var LV_COLS={
    nid:EMP_COLS.nid,
    name:EMP_COLS.name,
    type:['نوع الإجازة','النوع','نوع الاجازه','type','leavetype'],
    start:['تاريخ البداية','تاريخ بداية الإجازة','بداية الإجازة','من','من تاريخ','تاريخ الإجازة','start','from','startdate'],
    days:['عدد الأيام','الأيام','المدة','عدد ايام الاجازه','days','duration'],
    note:['ملاحظة','ملاحظات','رقم الطلب','note','notes','ref']
  };
  var LABEL={name:'الاسم',nid:'رقم الهوية',job:'المسمى',loc:'المقر',start:'التاريخ',ent:'الرصيد السنوي',used:'المستهلك سابقًا',type:'نوع الإجازة',days:'عدد الأيام',note:'ملاحظة'};

  function mapCols(headers, spec){
    var m={}, nh=headers.map(norm);
    Object.keys(spec).forEach(function(k){
      var opts=spec[k].map(norm);
      for(var i=0;i<nh.length;i++){ if(opts.indexOf(nh[i])>=0){ m[k]=headers[i]; return; } }
      for(var j=0;j<nh.length;j++){ for(var o=0;o<opts.length;o++){
        if(opts[o].length>2 && nh[j].indexOf(opts[o])>=0 && Object.keys(m).every(function(x){ return m[x]!==headers[j]; })){ m[k]=headers[j]; return; } } }
    });
    return m;
  }
  function matchType(v){
    var n=norm(v); if(!n) return TYPES[0].k;
    var alias={'سنويه':'اعتيادية (سنوية)','اعتياديه':'اعتيادية (سنوية)','سنوي':'اعتيادية (سنوية)','annual':'اعتيادية (سنوية)',
      'اضطراريه':'اضطرارية','emergency':'اضطرارية','مرضيه':'مرضية','sick':'مرضية','وضع':'وضع','امومه':'وضع','maternity':'وضع',
      'زواج':'زواج','marriage':'زواج','وفاه':'وفاة','death':'وفاة','بدوناجر':'بدون أجر','unpaid':'بدون أجر'};
    for(var i=0;i<TYPES.length;i++) if(norm(TYPES[i].k)===n) return TYPES[i].k;
    for(var a in alias) if(n.indexOf(a)>=0) return alias[a];
    return 'أخرى';
  }

  var PENDING=null;

  async function analyze(res){
    var out={file:res.file, emps:[], lvs:[], sheets:[], errors:[]};
    if(res.kind==='backup'){
      var d=res.data||{};
      out.backup=true;
      out.emps=(d.employees||[]).filter(function(x){ return x&&x.nid; });
      out.lvs=(d.leaves||[]).filter(function(x){ return x&&x.nid; });
      return out;
    }
    for(var s=0;s<res.sheets.length;s++){
      var sh=res.sheets[s], rows=sh.rows||[];
      if(!rows.length){ out.sheets.push({name:sh.name, kind:'empty', rows:0}); continue; }
      var headers=Object.keys(rows[0]);
      rows.forEach(function(r){ Object.keys(r).forEach(function(k){ if(headers.indexOf(k)<0) headers.push(k); }); });
      var me=mapCols(headers,EMP_COLS), ml=mapCols(headers,LV_COLS);
      var isLeave = ml.nid && ml.days && (ml.type || /اجاز|leave/i.test(norm(sh.name))) && !me.ent && !me.job;
      var info={name:sh.name, rows:rows.length, ok:0, bad:0};
      if(isLeave){
        info.kind='leaves'; info.map=ml;
        var dates=await API.toISOMany(rows.map(function(r){ return r[ml.start]; }));
        rows.forEach(function(r,i){
          var nid=digits(r[ml.nid]).replace(/\D/g,''), days=num(r[ml.days],0);
          if(!nid && ml.name){ var byName=EMP.concat(out.emps).filter(function(e){ return norm(e.name)===norm(r[ml.name]); })[0]; if(byName) nid=byName.nid; }
          if(!nid && !days && !dates[i]) return;
          var why=[];
          if(!nid) why.push('رقم الهوية مفقود');
          if(!dates[i]) why.push('تاريخ البداية غير مفهوم');
          if(!(days>0)) why.push('عدد الأيام غير صحيح');
          if(why.length){ info.bad++; out.errors.push(sh.name+' — صف '+(i+2)+': '+why.join('، ')); return; }
          info.ok++;
          out.lvs.push({nid:nid, name:ml.name?String(r[ml.name]).trim():'', type:matchType(ml.type?r[ml.type]:''),
            start:dates[i], days:days, note:ml.note?String(r[ml.note]).trim():''});
        });
      } else if(me.name && me.nid){
        info.kind='employees'; info.map=me;
        var sd=await API.toISOMany(rows.map(function(r){ return me.start?r[me.start]:''; }));
        rows.forEach(function(r,i){
          var name=String(r[me.name]||'').trim(), nid=digits(r[me.nid]).replace(/\D/g,'');
          if(!name && !nid) return;
          var why=[];
          if(!name) why.push('الاسم مفقود');
          if(!nid) why.push('رقم الهوية مفقود');
          if(why.length){ info.bad++; out.errors.push(sh.name+' — صف '+(i+2)+': '+why.join('، ')); return; }
          if(!sd[i]) out.errors.push(sh.name+' — صف '+(i+2)+' (استُورد مع تنبيه): '+name+' — تاريخ المباشرة فارغ، أكمله من زر «تعديل» ليُحسب رصيده');
          if(nid.length!==10) out.errors.push(sh.name+' — صف '+(i+2)+' (استُورد مع تنبيه): رقم الهوية ليس عشرة أرقام ('+nid+')');
          info.ok++;
          out.emps.push({nid:nid, name:name, job:me.job?String(r[me.job]).trim():'', loc:me.loc?String(r[me.loc]).trim():'',
            start:sd[i], ent:me.ent?num(r[me.ent],21)||21:21, used:me.used?num(r[me.used],0):0});
        });
      } else {
        info.kind='unknown'; info.headers=headers;
      }
      out.sheets.push(info);
    }
    return out;
  }

  function showImport(a){
    PENDING=a;
    $('impFile').textContent='الملف: '+a.file;
    var html='';
    if(a.backup){
      html='<div class="imp-sheet"><h3>نسخة احتياطية من التطبيق</h3><div class="imp-stats">'+
        '<b>'+a.emps.length+'</b> موظف · <b>'+a.lvs.length+'</b> إجازة</div></div>';
      $('impMode').value='replace';
    } else {
      a.sheets.forEach(function(s){
        if(s.kind==='empty'){ html+='<div class="imp-sheet"><h3>ورقة «'+esc(s.name)+'»</h3><span class="d">فارغة — تُتجاهل.</span></div>'; return; }
        if(s.kind==='unknown'){
          html+='<div class="imp-sheet"><h3>ورقة «'+esc(s.name)+'» — لم يُتعرَّف عليها</h3>'+
            '<div class="hint" style="font-size:.78rem;color:var(--muted)">الأعمدة الموجودة: '+esc((s.headers||[]).join('، '))+
            '<br>لاستيراد الموظفين يلزم عمودا «الاسم» و«رقم الهوية»؛ وللإجازات «رقم الهوية» و«نوع الإجازة» و«عدد الأيام».</div></div>';
          return;
        }
        var keys = s.kind==='employees'?['name','nid','job','loc','start','ent','used']:['nid','name','type','start','days','note'];
        var need = s.kind==='employees'?['name','nid','start']:['nid','start','days'];
        html+='<div class="imp-sheet"><h3>ورقة «'+esc(s.name)+'» — '+(s.kind==='employees'?'بيانات موظفين':'سجل إجازات')+'</h3>'+
          '<div class="imp-map">'+keys.map(function(k){
            var c=s.map[k];
            return '<span class="'+(!c&&need.indexOf(k)>=0?'miss':'')+'">'+LABEL[k]+' ← '+(c?esc(c):'غير موجود')+'</span>';
          }).join('')+'</div>'+
          '<div class="imp-stats">'+s.rows+' صف · <b>'+s.ok+'</b> صالح'+(s.bad?' · <span style="color:var(--crit)">'+s.bad+' مرفوض</span>':'')+'</div></div>';
      });
      var newE=a.emps.filter(function(e){ return !EMP.some(function(x){ return x.nid===e.nid; }); }).length;
      html+='<div class="calc">سيُضاف <b>'+newE+'</b> موظف جديد، ويُحدَّث <b>'+(a.emps.length-newE)+'</b> موجود، وتُضاف <b>'+a.lvs.length+'</b> إجازة (عند الدمج).</div>';
      $('impMode').value='merge';
    }
    if(a.errors.length) html+='<div class="imp-errs">'+a.errors.slice(0,200).map(esc).join('<br>')+'</div>';
    $('impBody').innerHTML=html;
    $('impErr').textContent = (!a.emps.length && !a.lvs.length) ? 'لا توجد بيانات صالحة للاستيراد في هذا الملف.' : '';
    $('impGo').disabled = !a.emps.length && !a.lvs.length;
    $('impPanel').hidden=false;
    $('impPanel').scrollIntoView({behavior:'smooth',block:'start'});
  }

  $('btnImport').addEventListener('click',async function(){
    try{
      var res=await API.pickImport(); if(!res) return;
      showImport(await analyze(res));
    }catch(e){ toast('تعذّرت قراءة الملف: '+(e&&e.message||e)); }
  });
  $('impCancel').addEventListener('click',function(){ $('impPanel').hidden=true; PENDING=null; });
  $('impGo').addEventListener('click',function(){
    var a=PENDING; if(!a) return;
    var mode=$('impMode').value;
    if(mode==='replace' && (EMP.length||LV.length) && !$('impGo').dataset.confirm){
      $('impGo').dataset.confirm='1'; $('impGo').textContent='تأكيد الاستبدال (ستُحذف البيانات الحالية)';
      setTimeout(function(){ delete $('impGo').dataset.confirm; $('impGo').textContent='تنفيذ الاستيراد'; },5000);
      return;
    }
    delete $('impGo').dataset.confirm; $('impGo').textContent='تنفيذ الاستيراد';
    if(mode==='replace'){ EMP=[]; LV=[]; }
    var added=0, updated=0, lvAdded=0, lvSkip=0;
    a.emps.forEach(function(e){
      var i=-1; for(var k=0;k<EMP.length;k++) if(EMP[k].nid===e.nid){ i=k; break; }
      if(i>=0){ EMP[i]=Object.assign({},EMP[i],e); updated++; } else { EMP.push(e); added++; }
    });
    a.lvs.forEach(function(l,idx){
      var dup=LV.some(function(x){ return x.nid===l.nid && x.start===l.start && x.type===l.type && Number(x.days)===Number(l.days); });
      if(dup){ lvSkip++; return; }
      var emp=EMP.filter(function(x){ return x.nid===l.nid; })[0];
      LV.push(Object.assign({}, l, {
        id: l.id || (l.nid+'-'+String(l.start).replace(/-/g,'')+'-'+Date.now().toString(36)+idx),
        name: (emp&&emp.name)||l.name||'', at: l.at || new Date().toISOString()}));
      lvAdded++;
    });
    var orphan=LV.filter(function(l){ return !EMP.some(function(e){ return e.nid===l.nid; }); }).length;
    logChange('imp','file',a.file, added+' جديد · '+updated+' محدَّث · '+lvAdded+' إجازة');
    render(); persist();
    $('impPanel').hidden=true; PENDING=null;
    toast('تم الاستيراد: '+added+' موظف جديد، '+updated+' محدَّث، '+lvAdded+' إجازة'+(lvSkip?' ('+lvSkip+' مكررة تُجوهلت)':'')+(orphan?' — '+orphan+' إجازة لموظف غير مسجّل':''));
  });

  // ===== نموذج الاستيراد =====
  $('btnTemplate').addEventListener('click',async function(){
    var p=await API.exportXlsx({fileName:'نموذج-استيراد-الإجازات.xlsx', sheets:[
      {name:'الموظفين', widths:[30,14,22,14,16,14,18], rows:[
        ['الاسم الرباعي','رقم الهوية','المسمى الوظيفي','مقر العمل','تاريخ المباشرة','الرصيد السنوي','رصيد مستهلك سابق'],
        ['محمد عبدالله أحمد السالم','1012345678','فني صيانة مصاعد','الرياض','2021-03-15',21,5]]},
      {name:'الإجازات', widths:[14,30,18,16,12,20], rows:[
        ['رقم الهوية','الاسم','نوع الإجازة','تاريخ البداية','عدد الأيام','ملاحظة'],
        ['1012345678','محمد عبدالله أحمد السالم','اعتيادية (سنوية)','2026-08-01',10,'طلب 1024']]}
    ]});
    if(p){ toast('حُفظ النموذج'); API.showFile(p); }
  });

  // ===== تصدير =====
  $('btnExport').addEventListener('click',async function(){
    var er=[['الاسم','رقم الهوية','المسمى الوظيفي','المقر','تاريخ المباشرة','مدة الخدمة','الرصيد السنوي','المستحق تراكميًا','المستخدم','الرصيد المتبقي','الحالة']];
    EMP.slice().sort(function(a,b){ return String(a.name).localeCompare(String(b.name),'ar'); }).forEach(function(r){
      var c=compute(r);
      er.push([r.name,r.nid,r.job||'',r.loc||'',r.start||'',c.svc.txt,c.ent,c.acc,c.used,c.bal,
        c.state==='crit'?'تجاوز':c.state==='warn'?'مرتفع':'متاح']);
    });
    var lr=[['رقم الهوية','الاسم','نوع الإجازة','تاريخ البداية','عدد الأيام','تُخصم من الرصيد','ملاحظة']];
    LV.slice().sort(function(a,b){ return String(b.start).localeCompare(String(a.start)); }).forEach(function(l){
      lr.push([l.nid,l.name||'',l.type,l.start,Number(l.days)||0,deducts(l.type)?'نعم':'لا',l.note||'']);
    });
    var p=await API.exportXlsx({fileName:'رصيد-الإجازات-'+new Date().toISOString().slice(0,10)+'.xlsx', sheets:[
      {name:'الأرصدة', widths:[30,14,22,14,14,16,12,14,10,12,10], rows:er},
      {name:'الإجازات', widths:[14,30,18,14,10,14,22], rows:lr}]});
    if(p){ toast('تم التصدير'); API.showFile(p); }
  });
  $('btnBackup').addEventListener('click',async function(){
    var p=await API.exportJson({version:1, savedAt:new Date().toISOString(), employees:EMP, leaves:LV, changes:CHG});
    if(p){ toast('حُفظت النسخة الاحتياطية'); API.showFile(p); }
  });
  $('dataFolder').addEventListener('click',function(e){ e.preventDefault(); API.openDataFolder(); });

  // ===== الوضع الليلي =====
  try{ if(localStorage.getItem('theme')==='dark') document.documentElement.setAttribute('data-theme','dark'); }catch(e){}
  $('theme').addEventListener('click',function(){
    var dark=document.documentElement.getAttribute('data-theme')==='dark';
    if(dark) document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme','dark');
    try{ localStorage.setItem('theme',dark?'light':'dark'); }catch(e){}
  });

  // ===== التحميل =====
  render();
  API.load().then(function(d){
    EMP=(d.employees||[]).filter(function(x){ return x&&x.nid; });
    LV=(d.leaves||[]).filter(function(x){ return x&&x.id&&x.nid; });
    CHG=d.changes||[];
    ready=true; render(); renderChanges(); calcPreview();
  }).catch(function(){ ready=true; render(); });
  setInterval(function(){ if(CHG.length) renderChanges(); }, 60000);
})();
