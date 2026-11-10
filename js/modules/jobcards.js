// Job cards: list, detail/form, man-hours, spares, approval, print
import { sb, S, run, rpc, fetchAll, isAdmin, isWs, isManager, myWorkshopId, wsById, wsName, storeName, productById, vehicleById, employeeById, userName, dropdown, vehicleOptions, lockDoc, unlockDoc } from '../core/api.js';
import { h, icon, pageHead, card, btn, iconBtn, modal, field, inp, textarea, act, toast, statusBadge, badge, confirmBox, promptBox, banner, kv, sectionTitle, tabsBar, emptyState, errMsg } from '../core/ui.js';
import { selectBox, strOpts } from '../core/select.js';
import { dataTable } from '../core/table.js';
import { navigate, replacePath } from '../core/router.js';
import { autosaver } from '../core/autosave.js';
import { printPreview, docHeader, docFooter, box } from '../core/print.js';
import { fmtDateTime, fmtDate, fmtNum, fmtMoney, fmtQty, fmtDuration, toLocalInput, fromLocalInput, num, esc, round } from '../core/format.js';

const isBlankDraft = (j) => j.status === 'draft' && !j.vehicle_id && !(j.complaint || '').trim() && !j.complaint_type && !(j.cause || '').trim() && !(j.corrective || '').trim();

/* =================================================================== LIST */
export async function list(ctx) {
  const root = h('div'); let rows = [];
  const tabs = tabsBar({ active: ctx.query.tab || 'all', tabs: [
    { key: 'all', label: 'All' }, { key: 'draft', label: 'Pending drafts' }, { key: 'open', label: 'Open' },
    { key: 'completed', label: 'Awaiting approval' }, { key: 'finalized', label: 'Finalized' }], onChange: (k) => { cur = k; apply(); } });
  let cur = ctx.query.tab || 'all';
  const tbl = dataTable({
    exportName: 'job-cards', defaultSort: { key: 'created_at', dir: 'desc' }, searchPlaceholder: 'Search job card, vehicle, complaint...',
    rowClass: (r) => (r.status === 'completed' ? 'row-warn' : ''),
    filters: [
      ...(isAdmin() ? [{ key: 'workshop_id', label: 'All workshops', options: S.workshops.map((w) => ({ value: w.id, label: w.name })) }] : []),
      { key: 'complaint_type', label: 'All complaint types' },
      { key: 'reg', label: 'All vehicles', value: (r) => vehicleById(r.vehicle_id)?.reg_no },
    ],
    columns: [
      { key: 'jc_no', label: 'Job card', render: (r) => h('span', { class: 'cell-main mono' }, r.jc_no || 'DRAFT') },
      { key: 'reg', label: 'Vehicle', value: (r) => vehicleById(r.vehicle_id)?.reg_no || '', render: (r) => { const v = vehicleById(r.vehicle_id); return v ? h('div', null, h('div', { class: 'cell-main' }, v.reg_no), h('div', { class: 'cell-sub' }, [v.fleet_no, v.make, v.model].filter(Boolean).join(' · '))) : '—'; } },
      ...(isAdmin() ? [{ key: 'workshop_id', label: 'Workshop', value: (r) => wsName(r.workshop_id) }] : []),
      { key: 'complaint_type', label: 'Type' },
      { key: 'complaint', label: 'Complaint', render: (r) => h('div', { style: { maxWidth: '320px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, title: r.complaint || '' }, r.complaint || '—') },
      { key: 'status', label: 'Status', render: (r) => statusBadge('jc', r.status) },
      { key: 'created_at', label: 'Created', render: (r) => h('div', null, h('div', null, fmtDateTime(r.opened_at || r.created_at)), h('div', { class: 'cell-sub' }, userName(r.created_by))) },
      { key: 'completed_at', label: 'Completed', render: (r) => (r.completed_at ? fmtDateTime(r.completed_at) : '—') },
    ],
    onRowClick: (r) => navigate(`/jobcards/${r.id}`),
    toolbar: isWs() ? [btn('New job card', { cls: 'primary sm', icon: 'plus', onClick: act(newJob) })] : [],
    empty: { icon: 'wrench', title: 'No job cards', text: 'Create a job card to start work on a vehicle.' },
  });
  async function newJob() {
    const r = await run(sb.from('job_cards').insert({ workshop_id: myWorkshopId() }).select('id').single());
    navigate(`/jobcards/${r.id}`);
  }
  const apply = () => { tbl.setRows(cur === 'all' ? rows : rows.filter((r) => r.status === cur)); };
  async function load() {
    rows = await fetchAll(() => sb.from('job_cards').select('*').order('created_at', { ascending: false }));
    const c = { all: rows.length }; ['draft', 'open', 'completed', 'finalized'].forEach((s) => (c[s] = rows.filter((r) => r.status === s).length));
    tabs.setCounts(c); apply();
  }
  if (ctx.query.new && isWs()) { await newJob(); return { el: root }; }
  await load();
  root.append(pageHead({ title: 'Job Cards', sub: isAdmin() ? 'All workshops' : wsName(myWorkshopId()) + ' - drafts and open jobs stay here until finalized.' }),
    h('div', { class: 'card' }, h('div', { style: { padding: '0 12px' } }, tabs), tbl.el));
  return { el: root, refresh: load };
}

/* =================================================================== DETAIL */
export async function detail(ctx) {
  const id = ctx.params.id; const root = h('div'); const view = { el: root, isForm: false };
  let jc, manhours = [], spares = [], mrfs = [], dcs = [];
  let canEdit = false; let lockMsg = null; let auto = null; let fields = null; let destroyed = false;

  async function load() {
    jc = await run(sb.from('job_cards').select('*').eq('id', id).maybeSingle());
    if (!jc) throw new Error('Job card not found or you do not have access to it.');
    [manhours, spares, mrfs, dcs] = await Promise.all([
      run(sb.from('jc_manhours').select('*').eq('job_card_id', id).order('start_ts')),
      run(sb.from('jc_spares').select('*').eq('job_card_id', id).order('created_at')),
      run(sb.from('mrfs').select('*').eq('job_card_id', id).order('created_at')),
      run(sb.from('delivery_challans').select('*').eq('job_card_id', id).order('created_at')),
    ]);
  }
  const editable = () => isWs() && jc.workshop_id === myWorkshopId() && ['draft', 'open'].includes(jc.status);

  async function acquire() {
    canEdit = false; lockMsg = null;
    if (!editable()) return;
    const r = await lockDoc('job_card', id);
    if (r.ok) canEdit = true; else lockMsg = `${r.holder} is editing this job card right now. You can view it, but not change it.`;
  }

  async function reloadAll() { if (auto) await auto.flush().catch(() => {}); await load(); await acquire(); draw(); }

  /* ----- collect + save ----- */
  const collect = () => {
    const v = fields.vehicle.getValue();
    const veh = vehicleById(v);
    return {
      vehicle_id: v,
      odometer: veh?.has_odometer && fields.odo.value !== '' ? num(fields.odo.value) : null,
      engine_hour: veh?.has_engine_hour && fields.eh.value !== '' ? num(fields.eh.value) : null,
      aux_hour: veh?.has_aux_hour && fields.ah.value !== '' ? num(fields.ah.value) : null,
      complaint_type: fields.ctype.getValue(), complaint: fields.complaint.value, cause: fields.cause.value, corrective: fields.corrective.value,
    };
  };
  async function save() {
    if (!canEdit || !fields) return;
    const d = collect();
    if (jc.vehicle_frozen) { delete d.vehicle_id; delete d.odometer; delete d.engine_hour; delete d.aux_hour; }
    await run(sb.from('job_cards').update(d).eq('id', id));
    Object.assign(jc, d);
  }

  function missingForOpen() {
    const d = collect(); const v = vehicleById(d.vehicle_id); const miss = [];
    if (!v) miss.push('vehicle');
    if (v?.has_odometer && d.odometer === null) miss.push('odometer reading');
    if (v?.has_engine_hour && d.engine_hour === null) miss.push('engine hour reading');
    if (v?.has_aux_hour && d.aux_hour === null) miss.push('auxiliary hour reading');
    if (!d.complaint_type) miss.push('complaint type');
    if (!d.complaint.trim()) miss.push('complaint');
    return miss;
  }

  /* ----- draw ----- */
  function draw() {
    root.replaceChildren();
    view.isForm = canEdit;
    ctx.setTitle(jc.jc_no || 'New job card', wsName(jc.workshop_id));
    auto = canEdit ? autosaver({ save }) : null;
    const dis = !canEdit;
    const frozen = jc.vehicle_frozen;

    const vehicleSel = selectBox({ options: vehicleOptions(true).concat(jc.vehicle_id && !vehicleOptions(true).find((o) => o.value === jc.vehicle_id) ? [{ value: jc.vehicle_id, label: vehicleById(jc.vehicle_id)?.reg_no || '?' }] : []), value: jc.vehicle_id, placeholder: 'Search vehicle by registration / fleet no...', disabled: dis || frozen, onChange: () => { readings(); auto?.trigger(); } });
    const odo = inp({ type: 'number', step: '0.1', min: '0', value: jc.odometer ?? '', disabled: dis || frozen });
    const eh = inp({ type: 'number', step: '0.1', min: '0', value: jc.engine_hour ?? '', disabled: dis || frozen });
    const ah = inp({ type: 'number', step: '0.1', min: '0', value: jc.aux_hour ?? '', disabled: dis || frozen });
    const ctype = selectBox({ options: strOpts(dropdown('complaint_type')), value: jc.complaint_type, placeholder: 'Select complaint type', disabled: dis, onChange: () => auto?.trigger() });
    const complaint = textarea({ value: jc.complaint || '', disabled: dis, placeholder: 'What is wrong with the vehicle?', rows: 3 });
    const cause = textarea({ value: jc.cause || '', disabled: dis, placeholder: 'Root cause found', rows: 3 });
    const corrective = textarea({ value: jc.corrective || '', disabled: dis, placeholder: 'Work done to fix it (mandatory before the job card can be completed)', rows: 3 });
    fields = { vehicle: vehicleSel, odo, eh, ah, ctype, complaint, cause, corrective };
    [odo, eh, ah, complaint, cause, corrective].forEach((e) => e.addEventListener('input', () => auto?.trigger()));

    const readingsBox = h('div', { class: 'form-grid' });
    function readings() {
      const v = vehicleById(vehicleSel.getValue()); readingsBox.replaceChildren();
      if (!v) { readingsBox.appendChild(h('div', { class: 'small muted full' }, 'Select a vehicle - the readings it needs will appear here.')); return; }
      if (v.has_odometer) readingsBox.appendChild(field('Odometer (km)', odo, { required: true }));
      if (v.has_engine_hour) readingsBox.appendChild(field('Engine hour', eh, { required: true }));
      if (v.has_aux_hour) readingsBox.appendChild(field('Auxiliary hour', ah, { required: true }));
    }
    readings();
    const veh = vehicleById(jc.vehicle_id);

    /* header */
    const steps = ['draft', 'open', 'completed', 'finalized']; const labels = ['Draft', 'Open', 'Awaiting approval', 'Finalized']; const at = steps.indexOf(jc.status);
    const stepper = h('div', { class: 'stepper' }, steps.flatMap((s, i) => [h('div', { class: `step ${i < at ? 'done' : i === at ? 'now' : ''}` }, h('span', { class: 'c' }, i < at ? '✓' : i + 1), labels[i]), i < steps.length - 1 ? h('span', { class: 'step-sep' }) : null]));

    const actions = [];
    actions.push(btn('Print', { cls: 'sm', icon: 'printer', onClick: act(doPrint) }));
    if (canEdit && jc.status === 'draft') {
      actions.push(btn('Delete draft', { cls: 'danger ghost sm', icon: 'trash', onClick: act(delDraft) }));
      actions.push(btn('Create job card', { cls: 'primary', icon: 'check', onClick: act(doOpen) }));
    }
    if (canEdit && jc.status === 'open') actions.push(btn('Complete job card', { cls: 'success', icon: 'checkCircle', onClick: act(doComplete) }));
    if (jc.status === 'completed' && isManager() && jc.workshop_id === myWorkshopId()) {
      actions.push(btn('Send back', { cls: 'sm', icon: 'undo', onClick: act(doSendBack) }), btn('Approve & finalize', { cls: 'success', icon: 'shield', onClick: act(doFinalize) }));
    }
    if (jc.status === 'finalized' && isAdmin()) actions.push(btn('Reverse finalization', { cls: 'danger ghost sm', icon: 'undo', onClick: act(doReverse) }));

    root.append(
      h('div', { class: 'page-head' },
        h('div', null, h('div', { class: 'row' }, h('h1', null, jc.jc_no || 'New job card'), statusBadge('jc', jc.status)), h('p', null, veh ? `${veh.reg_no} · ${wsName(jc.workshop_id)}` : wsName(jc.workshop_id))),
        h('div', { class: 'actions' }, auto ? auto.el : null, actions)),
      lockMsg ? h('div', { class: 'mb' }, banner('warn', h('span', null, lockMsg, ' ', h('a', { href: '#', onClick: (e) => { e.preventDefault(); reloadAll(); } }, 'Try again')))) : null,
      jc.status === 'completed' ? h('div', { class: 'mb' }, banner('warn', isManager() ? 'This job card is waiting for your approval. Once finalized it cannot be modified.' : 'Completed - waiting for the workshop manager to approve and finalize.')) : null,
      jc.status === 'finalized' ? h('div', { class: 'mb' }, banner('ok', `Finalized on ${fmtDateTime(jc.finalized_at)} by ${userName(jc.finalized_by)}. This record is locked.`, 'lock')) : null,
      frozen && canEdit ? h('div', { class: 'mb' }, banner('info', 'Vehicle details are frozen because a material request has been raised - the stores team has recorded them.', 'lock')) : null,
      h('div', { class: 'card mb' }, h('div', { class: 'card-body' }, stepper)),
      card({ title: 'Vehicle & complaint', cls: 'mb', body: h('div', { class: 'col', style: { gap: '14px' } },
        h('div', { class: 'form-grid' }, field('Vehicle', vehicleSel, { required: true, cls: 'span2' }), field('Complaint type', ctype, { required: true })),
        readingsBox,
        h('div', { class: 'form-grid' }, field('Complaint', complaint, { required: true, cls: 'full' }), field('Cause', cause, { cls: 'full' }),
          field('Corrective action', corrective, { cls: 'full', hint: 'Optional while working, mandatory to complete the job card.' })),
        jc.status !== 'draft' ? kv([['Created by', `${userName(jc.created_by)}`], ['Created on', fmtDateTime(jc.opened_at)], jc.completed_at ? ['Completed at', fmtDateTime(jc.completed_at)] : null]) : h('div', { class: 'small muted' }, 'Created automatically with the date and time when you press "Create job card". Until then everything is saved as a draft.')) }),
    );
    if (jc.status === 'draft') {
      root.append(banner('info', 'Man-hours, spares and material requests can be added once the job card is created.'));
    } else {
      root.append(manhoursCard(), sparesCard(), materialsCard());
    }
  }

  /* ----- sections ----- */
  function manhoursCard() {
    const live = manhours.filter((m) => !m.voided); const total = live.reduce((a, m) => a + (new Date(m.end_ts) - new Date(m.start_ts)), 0);
    const t = dataTable({
      exportName: 'manhours', hideToolbar: true, hideFooter: true, autoHeight: true, pageSize: 100, stack: true, rows: manhours,
      rowClass: (r) => (r.voided ? 'row-muted' : ''),
      columns: [
        { key: 'emp', label: 'Employee', value: (r) => employeeById(r.employee_id)?.name, render: (r) => h('div', null, h('div', { class: 'cell-main' }, employeeById(r.employee_id)?.name || '?'), h('div', { class: 'cell-sub' }, employeeById(r.employee_id)?.designation || '')) },
        { key: 'start_ts', label: 'Start', render: (r) => fmtDateTime(r.start_ts) }, { key: 'end_ts', label: 'End', render: (r) => fmtDateTime(r.end_ts) },
        { key: 'dur', label: 'Duration', value: (r) => new Date(r.end_ts) - new Date(r.start_ts), render: (r) => fmtDuration(new Date(r.end_ts) - new Date(r.start_ts)) },
        { key: 'x', label: '', sortable: false, render: (r) => r.voided ? badge('Voided', 'danger', true) : (canEdit ? h('div', { class: 'actions' }, iconBtn('trash', 'Void entry', act(() => voidLine('manhour', r.id)))) : null) },
      ],
      empty: { icon: 'clock', title: 'No man-hours booked', text: 'Add the employees who worked on this job.' },
    });
    return card({ title: h('div', { class: 'row' }, h('h3', null, 'Man hours'), badge(`Total ${fmtDuration(total)}`, 'info', true)), cls: 'mb', flush: true,
      actions: canEdit && jc.status === 'open' ? [btn('Add man hours', { cls: 'sm primary', icon: 'plus', onClick: addManhour })] : null, body: t.el });
  }

  function sparesCard() {
    const live = spares.filter((s) => !s.voided); const total = live.reduce((a, s) => a + Number(s.amount), 0);
    const t = dataTable({
      exportName: 'spares', hideToolbar: true, hideFooter: true, autoHeight: true, pageSize: 100, rows: spares, rowClass: (r) => (r.voided ? 'row-muted' : ''),
      columns: [
        { key: 'p', label: 'Spare', value: (r) => productById(r.product_id)?.item_code, render: (r) => { const p = productById(r.product_id); return h('div', null, h('div', { class: 'cell-main' }, p?.description || '?'), h('div', { class: 'cell-sub mono' }, p?.item_code || '')); } },
        { key: 'qty', label: 'Consumed', num: true, render: (r) => fmtQty(productById(r.product_id), r.qty) },
        { key: 'rate', label: 'Rate / unit', num: true, render: (r) => fmtMoney(r.rate) }, { key: 'amount', label: 'Value', num: true, render: (r) => fmtMoney(r.amount) },
        { key: 'source', label: 'From', render: (r) => (r.source === 'dc' ? badge('Store issue', 'info', true) : badge('Workshop stock', 'teal', true)) },
        { key: 'note', label: 'Note' },
        { key: 'x', label: '', sortable: false, render: (r) => r.voided ? badge('Voided', 'danger', true) : (canEdit ? h('div', { class: 'actions' }, iconBtn('trash', 'Void entry', act(() => voidLine('spare', r.id)))) : null) },
      ],
      footer: () => h('tr', null, h('td', { colspan: 3 }, 'Total spares value'), h('td', { class: 'num' }, fmtMoney(total)), h('td', { colspan: 3 })),
      empty: { icon: 'package', title: 'No spares used yet', text: 'Spares are added automatically when you acknowledge a store delivery, or use stock you already hold.' },
    });
    return card({ title: h('div', { class: 'row' }, h('h3', null, 'Spares used'), badge(fmtMoney(total), 'teal', true)), cls: 'mb', flush: true,
      actions: canEdit && jc.status === 'open' ? [btn('Use from workshop stock', { cls: 'sm primary', icon: 'plus', onClick: addSpare })] : null, body: t.el });
  }

  function materialsCard() {
    const mrows = mrfs.filter((m) => m.status !== 'draft' || (isWs()));
    return card({ title: 'Material requests & deliveries', cls: 'mb',
      actions: canEdit && jc.status === 'open' ? [btn('Raise MRF', { cls: 'sm primary', icon: 'clipboard', onClick: act(raiseMrf) })] : null,
      body: !mrows.length && !dcs.length ? emptyState({ icon: 'clipboard', title: 'No material requests', text: 'Raise an MRF to request spares from a store.' }) :
        h('div', { class: 'col' }, mrows.map((m) => {
          const mdcs = dcs.filter((d) => d.mrf_id === m.id);
          return h('div', { class: 'card', style: { boxShadow: 'none' } }, h('div', { class: 'card-body row between' },
            h('div', null, h('a', { class: 'bold mono', href: isWs() || isAdmin() ? `#/mrfs/${m.id}` : `#/inbox/${m.id}` }, m.mrf_no || 'Draft MRF'), h('div', { class: 'small muted' }, `${storeName(m.store_id)} · ${fmtDateTime(m.sent_at || m.created_at)}`)),
            h('div', { class: 'row' }, mdcs.map((d) => h('a', { href: `#/receipts/${d.id}`, class: 'badge b-info plain' }, `${d.dc_no || 'DC'} · ${d.status}`)), statusBadge('mrf', m.status))));
        })) });
  }

  /* ----- actions ----- */
  async function addManhour() {
    const emps = S.employees.filter((e) => e.workshop_id === jc.workshop_id && e.active);
    if (!emps.length) throw new Error('No active employees in this workshop. Ask the manager to add employees in the Employee Master.');
    const emp = selectBox({ options: emps.map((e) => ({ value: e.id, label: e.name, sub: `${e.emp_code}${e.designation ? ' · ' + e.designation : ''}` })), placeholder: 'Select employee' });
    const now = new Date(); const s = inp({ type: 'datetime-local', value: toLocalInput(new Date(now - 3600000)) }); const e = inp({ type: 'datetime-local', value: toLocalInput(now) });
    const dur = h('div', { class: 'small muted' }); const upd = () => { const d = new Date(e.value) - new Date(s.value); dur.textContent = d >= 0 ? `Duration: ${fmtDuration(d)}` : 'End must be after start'; }; s.oninput = e.oninput = upd; upd();
    const m = modal({ title: 'Add man hours', content: h('div', { class: 'col' }, field('Employee', emp, { required: true }), h('div', { class: 'form-grid' }, field('Start', s, { required: true }), field('End', e, { required: true })), dur),
      foot: [btn('Cancel', { cls: '', onClick: () => m.close() }), btn('Add', { cls: 'primary', onClick: act(async () => {
        if (!emp.getValue()) throw new Error('Select an employee');
        if (!s.value || !e.value || new Date(e.value) < new Date(s.value)) throw new Error('End time must be after the start time');
        if (new Date(e.value) > Date.now() + 300000) throw new Error('End time cannot be in the future');
        await run(sb.from('jc_manhours').insert({ job_card_id: id, employee_id: emp.getValue(), start_ts: fromLocalInput(s.value), end_ts: fromLocalInput(e.value) }));
        toast('Man hours added'); m.close(); await reloadAll();
      }) })] });
  }

  async function addSpare() {
    const bal = await run(sb.from('stock_balances').select('*').eq('location_type', 'workshop').eq('location_id', jc.workshop_id).gt('qty', 0));
    if (!bal.length) throw new Error('Your workshop has no stock. Request materials from the store with an MRF, or move delivered items to workshop stock.');
    const avail = new Map(bal.map((b) => [b.product_id, Number(b.qty)]));
    const prod = selectBox({ options: bal.map((b) => productById(b.product_id)).filter(Boolean).map((p) => ({ value: p.id, label: `${p.item_code} · ${p.description}`, sub: `Available: ${fmtQty(p, avail.get(p.id))}` })), placeholder: 'Select spare from your stock', onChange: upd });
    const qty = inp({ type: 'number', min: '0', step: 'any', placeholder: 'Quantity' }); const note = inp({ placeholder: 'Optional note' });
    const unit = h('span', { class: 'muted' }); const info = h('div', { class: 'small muted' });
    function upd() { const p = productById(prod.getValue()); unit.textContent = p ? p.base_uom : ''; qty.step = p?.allow_decimal ? 'any' : '1'; info.textContent = p ? `Available ${fmtQty(p, avail.get(p.id))}${p.allow_decimal ? ' · decimals allowed' : ' · whole numbers only'}` : ''; }
    const m = modal({ title: 'Use spare from workshop stock', content: h('div', { class: 'col' }, field('Spare', prod, { required: true }), field('Quantity consumed', h('div', { class: 'row nowrap' }, qty, unit), { required: true }), info, field('Note', note)),
      foot: [btn('Cancel', { cls: '', onClick: () => m.close() }), btn('Add to job card', { cls: 'primary', onClick: act(async () => {
        const p = productById(prod.getValue()); if (!p) throw new Error('Select a spare');
        const q = num(qty.value); if (!(q > 0)) throw new Error('Enter a quantity greater than zero');
        if (q > avail.get(p.id)) throw new Error(`Only ${fmtQty(p, avail.get(p.id))} available in your workshop stock`);
        await auto?.flush(); await rpc('jc_consume', { p_jc: id, p_product: p.id, p_qty: q, p_note: note.value.trim() || null });
        toast('Spare added'); m.close(); await reloadAll();
      }) })] });
  }

  async function voidLine(kind, lineId) {
    const reason = await promptBox({ title: 'Void this entry', message: kind === 'spare' ? 'The quantity goes back to your workshop stock and a reversing entry is written to the ledger.' : 'The entry stays on record, marked as voided.', label: 'Reason', tone: 'danger', confirmText: 'Void entry' });
    if (!reason) return;
    await rpc('jc_void_line', { p_kind: kind, p_id: lineId, p_reason: reason }); toast('Entry voided', 'warn'); await reloadAll();
  }

  async function doOpen() {
    const miss = missingForOpen(); if (miss.length) throw new Error(`Please fill: ${miss.join(', ')}`);
    await auto.flush(); const no = await rpc('jc_open', { p_id: id });
    toast(`Job card ${no} created`); replacePath(`/jobcards/${id}`); await reloadAll();
  }
  async function delDraft() {
    if (!(await confirmBox({ title: 'Delete this draft?', message: 'The draft will be removed permanently. (Created job cards can never be deleted.)', tone: 'danger', confirmText: 'Delete draft' }))) return;
    auto.disable(); canEdit = false; await run(sb.from('job_cards').delete().eq('id', id)); toast('Draft deleted'); navigate('/jobcards');
  }
  async function doComplete() {
    await auto.flush();
    if (!(jc.corrective || '').trim()) { fields.corrective.classList.add('invalid'); fields.corrective.focus(); throw new Error('Corrective action is mandatory to complete the job card'); }
    const pendingMrf = mrfs.filter((m) => ['draft', 'returned'].includes(m.status)); const openMrf = mrfs.filter((m) => m.status === 'sent');
    const ts = inp({ type: 'datetime-local', value: toLocalInput(new Date()) });
    const m = modal({ title: 'Complete job card', content: h('div', { class: 'col' },
      banner('info', 'Completion sends the job card to your workshop manager for approval. Open MRF lines that are not fulfilled will be closed automatically.'),
      pendingMrf.length ? banner('warn', `${pendingMrf.length} draft / returned MRF(s) must be sent or deleted first.`) : null,
      openMrf.length ? banner('warn', `${openMrf.length} open MRF(s) will be closed.`) : null,
      field('Completion date & time', ts, { required: true })),
    foot: [btn('Cancel', { cls: '', onClick: () => m.close() }), btn('Mark as complete', { cls: 'success', onClick: act(async () => {
      if (!ts.value) throw new Error('Enter the completion time');
      await rpc('jc_complete', { p_id: id, p_completed_at: fromLocalInput(ts.value) }); toast('Job card completed - sent for approval'); m.close(); await reloadAll();
    }) })] });
  }
  async function doFinalize() {
    if (!(await confirmBox({ title: 'Approve & finalize?', message: 'After finalizing, the job card is locked and cannot be modified. Any later correction must be reversed step by step.', confirmText: 'Finalize', tone: 'success' }))) return;
    await rpc('jc_finalize', { p_id: id }); toast('Job card finalized'); await reloadAll();
  }
  async function doSendBack() { const r = await promptBox({ title: 'Send back for correction', label: 'What needs to be corrected?', confirmText: 'Send back' }); if (!r) return; await rpc('jc_send_back', { p_id: id, p_reason: r }); toast('Sent back to the workshop', 'warn'); await reloadAll(); }
  async function doReverse() { const r = await promptBox({ title: 'Reverse finalization', message: 'The job card returns to "Awaiting approval". The reason is written to the audit log.', label: 'Reason', tone: 'danger', confirmText: 'Reverse' }); if (!r) return; await rpc('jc_reverse_finalize', { p_id: id, p_reason: r }); toast('Finalization reversed', 'warn'); await reloadAll(); }
  async function raiseMrf() {
    await auto.flush(); const miss = missingForOpen(); if (miss.length) throw new Error(`Complete the job card details first: ${miss.join(', ')}`);
    const r = await run(sb.from('mrfs').insert({ job_card_id: id }).select('id').single()); navigate(`/mrfs/${r.id}`);
  }

  async function doPrint() {
    if (auto) await auto.flush().catch(() => {});
    const d = canEdit && fields ? collect() : jc; const v = vehicleById(d.vehicle_id);
    if (!v || !(d.complaint || '').trim()) throw new Error('Select the vehicle and enter the complaint before printing.');
    const readingsHtml = [v.has_odometer ? `<div><b>Odometer:</b> ${d.odometer ?? '______'} km</div>` : '', v.has_engine_hour ? `<div><b>Engine hour:</b> ${d.engine_hour ?? '______'}</div>` : '', v.has_aux_hour ? `<div><b>Aux hour:</b> ${d.aux_hour ?? '______'}</div>` : ''].join('');
    const live = manhours.filter((m) => !m.voided); const sp = spares.filter((s) => !s.voided);
    const blank = (n, c) => Array.from({ length: n }, () => `<tr class="blankrow">${'<td></td>'.repeat(c)}</tr>`).join('');
    const html = `${docHeader({ title: 'Job Card', no: jc.jc_no, status: jc.status === 'draft' ? 'Draft' : jc.status })}
      <div class="grid3">
        ${box('Workshop', `<div class="big">${esc(wsName(jc.workshop_id))}</div>${esc(wsById(jc.workshop_id)?.address || '')}`)}
        ${box('Vehicle', `<div class="big">${esc(v.reg_no)}</div>${esc([v.fleet_no, v.make, v.model].filter(Boolean).join(' · '))}`)}
        ${box('Readings', readingsHtml || '—')}
      </div>
      <div class="grid3">
        ${box('Created', `${esc(jc.opened_at ? fmtDateTime(jc.opened_at) : fmtDateTime(new Date()))}<br>${esc(userName(jc.created_by))}`)}
        ${box('Complaint type', `<div class="big">${esc(d.complaint_type || '—')}</div>`)}
        ${box('Completed at', jc.completed_at ? esc(fmtDateTime(jc.completed_at)) : '<br>')}
      </div>
      <div class="write"><div class="wl">Complaint</div><div class="wb">${esc(d.complaint)}</div></div>
      <div class="write"><div class="wl">Cause</div><div class="wb ruled">${esc(d.cause || '')}</div></div>
      <div class="write"><div class="wl">Corrective action</div><div class="wb ruled">${esc(d.corrective || '')}</div></div>
      <table><thead><tr><th style="width:30%">Employee</th><th>Start</th><th>End</th><th class="num">Hours</th></tr></thead><tbody>
        ${live.map((m) => `<tr><td>${esc(employeeById(m.employee_id)?.name)}</td><td>${esc(fmtDateTime(m.start_ts))}</td><td>${esc(fmtDateTime(m.end_ts))}</td><td class="num">${fmtDuration(new Date(m.end_ts) - new Date(m.start_ts))}</td></tr>`).join('')}${blank(Math.max(4, 7 - live.length), 4)}</tbody></table>
      <table><thead><tr><th style="width:40%">Spare used</th><th>Item code</th><th class="num">Qty</th><th>Unit</th></tr></thead><tbody>
        ${sp.map((s) => { const p = productById(s.product_id); return `<tr><td>${esc(p?.description)}</td><td>${esc(p?.item_code)}</td><td class="num">${fmtNum(s.qty)}</td><td>${esc(p?.base_uom)}</td></tr>`; }).join('')}${blank(Math.max(4, 7 - sp.length), 4)}</tbody></table>
      <div class="sig"><div>Mechanic</div><div>Supervisor</div><div>Workshop Manager</div><div>Driver / Receiver</div></div>
      ${docFooter(S.profile.full_name)}`;
    printPreview(jc.jc_no || 'Job card', html);
  }

  await load(); await acquire(); draw();
  view.flush = async () => { if (auto) await auto.flush(); };
  view.destroy = async () => {
    destroyed = true;
    if (canEdit) {
      try { if (auto) await auto.flush(); } catch { /* ignore */ }
      try { if (fields && isBlankDraft({ ...jc, ...collect() })) await sb.from('job_cards').delete().eq('id', id).eq('status', 'draft'); } catch { /* ignore */ }
      await unlockDoc('job_card', id);
    }
  };
  view.refresh = async () => { if (canEdit || document.querySelector('.overlay')) return; await load(); draw(); };
  view.liveNotice = () => {};
  return view;
}
