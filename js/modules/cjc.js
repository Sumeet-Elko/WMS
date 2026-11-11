// Consumable Job Cards: many vehicles, consumable spares per vehicle (from workshop stock), shared man-hours
import { sb, S, run, rpc, fetchAll, isAdmin, isWs, isManager, myWorkshopId, wsById, wsName, productById, vehicleById, employeeById, userName, dropdown, lockDoc, unlockDoc } from '../core/api.js';
import { h, pageHead, card, btn, iconBtn, modal, field, inp, textarea, act, toast, statusBadge, badge, confirmBox, promptBox, banner, kv, tabsBar, emptyState } from '../core/ui.js';
import { selectBox } from '../core/select.js';
import { dataTable } from '../core/table.js';
import { navigate, replacePath } from '../core/router.js';
import { printPreview, docHeader, docFooter, box } from '../core/print.js';
import { fmtDateTime, fmtNum, fmtMoney, fmtQty, fmtDuration, toLocalInput, fromLocalInput, num, esc } from '../core/format.js';

// spare types the admin has ticked for consumable job cards
const allowedTypes = () => new Set(S.dropdowns.filter((d) => d.category === 'spare_type' && d.consumable && d.active).map((d) => d.value));

/* =================================================================== LIST */
export async function list(ctx) {
  const root = h('div'); let rows = []; let cur = ctx.query.tab || 'all'; let vcount = new Map();
  const tabs = tabsBar({ active: cur, tabs: [{ key: 'all', label: 'All' }, { key: 'draft', label: 'Pending drafts' }, { key: 'open', label: 'Open' }, { key: 'completed', label: 'Awaiting approval' }, { key: 'finalized', label: 'Finalized' }], onChange: (k) => { cur = k; apply(); } });
  const tbl = dataTable({
    exportName: 'consumable-job-cards', defaultSort: { key: 'created_at', dir: 'desc' }, searchPlaceholder: 'Search consumable job card...',
    rowClass: (r) => (r.status === 'completed' ? 'row-warn' : ''),
    filters: isAdmin() ? [{ key: 'workshop_id', label: 'All workshops', options: S.workshops.map((w) => ({ value: w.id, label: w.name })) }] : [],
    columns: [
      { key: 'cjc_no', label: 'Card no', render: (r) => h('span', { class: 'cell-main mono' }, r.cjc_no || 'DRAFT') },
      ...(isAdmin() ? [{ key: 'workshop_id', label: 'Workshop', value: (r) => wsName(r.workshop_id) }] : []),
      { key: 'veh', label: 'Vehicles', num: true, value: (r) => vcount.get(r.id) || 0 },
      { key: 'remarks', label: 'Remarks', render: (r) => h('div', { style: { maxWidth: '320px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, r.remarks || '—') },
      { key: 'status', label: 'Status', render: (r) => statusBadge('jc', r.status) },
      { key: 'created_at', label: 'Created', render: (r) => h('div', null, h('div', null, fmtDateTime(r.opened_at || r.created_at)), h('div', { class: 'cell-sub' }, userName(r.created_by))) },
      { key: 'completed_at', label: 'Completed', render: (r) => (r.completed_at ? fmtDateTime(r.completed_at) : '—') },
    ],
    onRowClick: (r) => navigate(`/cjc/${r.id}`),
    toolbar: isWs() ? [btn('New consumable job card', { cls: 'primary sm', icon: 'plus', onClick: act(newCard) })] : [],
    empty: { icon: 'layers', title: 'No consumable job cards', text: 'Use one card to record oil, grease and other consumables across many vehicles.' },
  });
  async function newCard() { const id = await rpc('cjc_create'); navigate(`/cjc/${id}`); }
  const apply = () => tbl.setRows(cur === 'all' ? rows : rows.filter((r) => r.status === cur));
  async function load() {
    rows = await fetchAll(() => sb.from('consumable_jcs').select('*').order('created_at', { ascending: false }));
    const vs = rows.length ? await fetchAll(() => sb.from('cjc_vehicles').select('cjc_id')) : []; vcount = new Map(); vs.forEach((v) => vcount.set(v.cjc_id, (vcount.get(v.cjc_id) || 0) + 1));
    const c = { all: rows.length }; ['draft', 'open', 'completed', 'finalized'].forEach((s) => (c[s] = rows.filter((r) => r.status === s).length)); tabs.setCounts(c); apply();
  }
  await load();
  root.append(pageHead({ title: 'Consumable Job Cards', sub: isAdmin() ? 'All workshops' : `${wsName(myWorkshopId())} - one card, many vehicles, consumables from workshop stock.` }), h('div', { class: 'card' }, h('div', { style: { padding: '0 12px' } }, tabs), tbl.el));
  return { el: root, refresh: load };
}

/* =================================================================== DETAIL */
export async function detail(ctx) {
  const id = ctx.params.id; const root = h('div'); const view = { el: root, isForm: false };
  let c, vehicles = [], spares = [], manhours = []; let canEdit = false; let lockMsg = null;

  async function load() {
    c = await run(sb.from('consumable_jcs').select('*').eq('id', id).maybeSingle()); if (!c) throw new Error('Consumable job card not found or no access.');
    [vehicles, spares, manhours] = await Promise.all([run(sb.from('cjc_vehicles').select('*').eq('cjc_id', id).order('created_at')), run(sb.from('cjc_spares').select('*').eq('cjc_id', id).order('created_at')), run(sb.from('cjc_manhours').select('*').eq('cjc_id', id).order('start_ts'))]);
  }
  const editable = () => isWs() && c.workshop_id === myWorkshopId() && ['draft', 'open'].includes(c.status);
  async function acquire() { canEdit = false; lockMsg = null; if (!editable()) return; const r = await lockDoc('cjc', id); if (r.ok) canEdit = true; else lockMsg = `${r.holder} is editing this card right now. You can view it, but not change it.`; }
  async function reloadAll() { const had = canEdit; await load(); await acquire(); if (had && !canEdit) await unlockDoc('cjc', id); draw(); }

  function draw() {
    root.replaceChildren(); view.isForm = canEdit; ctx.setTitle(c.cjc_no || 'New consumable job card', wsName(c.workshop_id));
    const steps = ['draft', 'open', 'completed', 'finalized']; const labels = ['Draft', 'Open', 'Awaiting approval', 'Finalized']; const at = steps.indexOf(c.status);
    const stepper = h('div', { class: 'stepper' }, steps.flatMap((s, i) => [h('div', { class: `step ${i < at ? 'done' : i === at ? 'now' : ''}` }, h('span', { class: 'c' }, i < at ? '✓' : i + 1), labels[i]), i < steps.length - 1 ? h('span', { class: 'step-sep' }) : null]));
    const remarks = textarea({ value: c.remarks || '', disabled: !canEdit, rows: 2, placeholder: 'Optional remarks (e.g. weekly top-up of engine oil and grease)' });
    remarks.addEventListener('change', act(async () => { await rpc('cjc_set_remarks', { p_id: id, p_remarks: remarks.value }); c.remarks = remarks.value.trim() || null; }));

    const actions = [btn('Print', { cls: 'sm', icon: 'printer', onClick: act(doPrint) })];
    if (canEdit && c.status === 'draft') actions.push(btn('Delete draft', { cls: 'danger ghost sm', icon: 'trash', onClick: act(delDraft) }), btn('Create consumable job card', { cls: 'primary', icon: 'check', onClick: act(doOpen) }));
    if (canEdit && c.status === 'open') actions.push(btn('Complete', { cls: 'success', icon: 'checkCircle', onClick: act(doComplete) }));
    if (c.status === 'completed' && isManager() && c.workshop_id === myWorkshopId()) actions.push(btn('Send back', { cls: 'sm', icon: 'undo', onClick: act(doSendBack) }), btn('Approve & finalize', { cls: 'success', icon: 'shield', onClick: act(doFinalize) }));
    if (c.status === 'finalized' && isAdmin()) actions.push(btn('Reverse finalization', { cls: 'danger ghost sm', icon: 'undo', onClick: act(doReverse) }));

    root.append(
      h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'row' }, h('h1', null, c.cjc_no || 'New consumable job card'), statusBadge('jc', c.status), badge('Consumable', 'teal', true)), h('p', null, `${wsName(c.workshop_id)} · ${vehicles.length} vehicle(s)`)), h('div', { class: 'actions' }, actions)),
      lockMsg ? h('div', { class: 'mb' }, banner('warn', h('span', null, lockMsg, ' ', h('a', { href: '#', onClick: (e) => { e.preventDefault(); reloadAll(); } }, 'Try again')))) : null,
      c.status === 'completed' ? h('div', { class: 'mb' }, banner('warn', isManager() ? 'Waiting for your approval. Once finalized it cannot be modified.' : 'Completed - waiting for the workshop manager to approve.')) : null,
      c.status === 'finalized' ? h('div', { class: 'mb' }, banner('ok', `Finalized on ${fmtDateTime(c.finalized_at)} by ${userName(c.finalized_by)}. This record is locked.`, 'lock')) : null,
      h('div', { class: 'card mb' }, h('div', { class: 'card-body' }, stepper)),
      card({ title: 'Details', cls: 'mb', body: h('div', { class: 'col' }, field('Remarks', remarks), c.status !== 'draft' ? kv([['Created by', userName(c.created_by)], ['Created on', fmtDateTime(c.opened_at)], c.completed_at ? ['Completed at', fmtDateTime(c.completed_at)] : null]) : h('div', { class: 'small muted' }, 'The card number and date are given when you press "Create consumable job card". Add the vehicles first; spares and man-hours are added after that.')) }),
      vehiclesCard());
    if (c.status !== 'draft') root.append(manhoursCard());
  }

  /* ----- vehicles + spares ----- */
  function vehiclesCard() {
    const total = spares.reduce((a, s) => a + Number(s.amount), 0);
    return card({ title: h('div', { class: 'row' }, h('h3', null, 'Vehicles & consumables'), c.status !== 'draft' ? badge(`Spares ${fmtMoney(total)}`, 'teal', true) : null), cls: 'mb',
      actions: canEdit ? [btn('Add vehicle', { cls: 'sm primary', icon: 'plus', onClick: addVehicle })] : null,
      body: !vehicles.length ? emptyState({ icon: 'truck', title: 'No vehicles yet', text: canEdit ? 'Press "Add vehicle" to start.' : '' }) :
        h('div', { class: 'col' }, vehicles.map((cv) => vehicleBlock(cv))) });
  }
  function vehicleBlock(cv) {
    const v = vehicleById(cv.vehicle_id); const ss = spares.filter((s) => s.cjc_vehicle_id === cv.id);
    const rows = ss.map((s) => {
      const p = productById(s.product_id);
      let qtyCell;
      if (canEdit && c.status === 'open') {
        const i = inp({ type: 'number', min: '0', step: p?.allow_decimal ? 'any' : '1', value: s.qty, style: { width: '100px', textAlign: 'right' }, title: 'Change the quantity actually used - the rest returns to workshop stock' });
        i.addEventListener('change', act(async () => {
          const q = num(i.value, -1); if (q < 0) { i.value = s.qty; throw new Error('Enter zero or more'); } if (q === Number(s.qty)) return;
          try { const d = Number(await rpc('cjc_set_spare_qty', { p_spare: s.id, p_qty: q })); toast(d < 0 ? `${fmtNum(-d)} ${p.base_uom} returned to workshop stock` : `${fmtNum(d)} ${p.base_uom} more taken from workshop stock`); await reloadAll(); } catch (e) { i.value = s.qty; throw e; }
        }));
        qtyCell = h('div', { class: 'row nowrap', style: { justifyContent: 'flex-end' } }, i, h('span', { class: 'small muted' }, p?.base_uom || ''));
      } else qtyCell = fmtQty(p, s.qty);
      return h('tr', null, h('td', null, h('div', { class: 'cell-main' }, p?.description || '?'), h('div', { class: 'cell-sub mono' }, p?.item_code || '')), h('td', { class: 'num' }, qtyCell), h('td', { class: 'num' }, fmtMoney(s.amount)), h('td', null, s.note || ''));
    });
    return h('div', { class: 'card', style: { boxShadow: 'none' } },
      h('div', { class: 'card-head' }, h('div', null, h('div', { class: 'bold' }, v?.reg_no || '?'), h('div', { class: 'small muted' }, [v?.fleet_no, v?.make, v?.model].filter(Boolean).join(' · '))),
        h('div', { class: 'row' }, canEdit && c.status === 'open' ? btn('Add spare', { cls: 'sm', icon: 'plus', onClick: () => addSpare(cv) }) : null,
          canEdit ? iconBtn('trash', 'Remove vehicle', act(async () => { if (!(await confirmBox({ title: `Remove ${v?.reg_no}?`, message: 'Only possible when no spares are consumed on it.', tone: 'danger', confirmText: 'Remove' }))) return; await rpc('cjc_remove_vehicle', { p_cjc_vehicle: cv.id }); await reloadAll(); })) : null)),
      h('div', { class: 'card-body', style: { padding: 0 } }, rows.length ? h('table', { class: 'dt' }, h('thead', null, h('tr', null, h('th', null, 'Spare'), h('th', { class: 'num' }, 'Consumed'), h('th', { class: 'num' }, 'Value'), h('th', null, 'Note'))), h('tbody', null, rows)) : h('div', { class: 'small muted', style: { padding: '12px 18px' } }, c.status === 'draft' ? 'Spares can be added after the card is created.' : 'No spares consumed on this vehicle yet.')));
  }

  async function addVehicle() {
    const have = new Set(vehicles.map((x) => x.vehicle_id));
    const opts = S.vehicles.filter((v) => v.active && !have.has(v.id)).map((v) => ({ value: v.id, label: v.reg_no, sub: [v.fleet_no, v.make, v.model].filter(Boolean).join(' · ') }));
    if (!opts.length) throw new Error('No more vehicles to add.');
    const sel = selectBox({ options: opts, placeholder: 'Search vehicle by registration / fleet no...' });
    const m = modal({ title: 'Add vehicle', content: field('Vehicle', sel, { required: true }), foot: [btn('Cancel', { cls: '', onClick: () => m.close() }), btn('Add', { cls: 'primary', onClick: act(async () => { if (!sel.getValue()) throw new Error('Select a vehicle'); await rpc('cjc_add_vehicle', { p_id: id, p_vehicle: sel.getValue() }); m.close(); await reloadAll(); }) })] });
  }

  async function addSpare(cv) {
    const ok = allowedTypes(); if (!ok.size) throw new Error('No spare type is enabled for consumable job cards. Ask the admin to tick the spare types in Admin > Dropdown Lists.');
    const bal = await run(sb.from('stock_balances').select('*').eq('location_type', 'workshop').eq('location_id', c.workshop_id).gt('qty', 0));
    const avail = new Map(bal.map((b) => [b.product_id, Number(b.qty)]));
    const prods = bal.map((b) => productById(b.product_id)).filter((p) => p && ok.has(p.spare_type));
    if (!prods.length) throw new Error('Your workshop stock has no consumable items. Raise a Facility MRF to stock them.');
    const prod = selectBox({ options: prods.map((p) => ({ value: p.id, label: `${p.item_code} · ${p.description}`, sub: `${p.spare_type} · Available: ${fmtQty(p, avail.get(p.id))}` })), placeholder: 'Select consumable from workshop stock', onChange: upd });
    const qty = inp({ type: 'number', min: '0', step: 'any', placeholder: 'Quantity' }); const note = inp({ placeholder: 'Optional note' }); const unit = h('span', { class: 'muted' }); const info = h('div', { class: 'small muted' });
    function upd() { const p = productById(prod.getValue()); unit.textContent = p ? p.base_uom : ''; qty.step = p?.allow_decimal ? 'any' : '1'; info.textContent = p ? `Available ${fmtQty(p, avail.get(p.id))}${p.allow_decimal ? ' · decimals allowed' : ' · whole numbers only'}` : ''; }
    const m = modal({ title: `Consumable for ${vehicleById(cv.vehicle_id)?.reg_no}`, content: h('div', { class: 'col' }, field('Spare', prod, { required: true, hint: 'Only spare types enabled for consumable job cards are listed.' }), field('Quantity consumed', h('div', { class: 'row nowrap' }, qty, unit), { required: true }), info, field('Note', note)),
      foot: [btn('Cancel', { cls: '', onClick: () => m.close() }), btn('Add', { cls: 'primary', onClick: act(async () => {
        const p = productById(prod.getValue()); if (!p) throw new Error('Select a spare'); const q = num(qty.value); if (!(q > 0)) throw new Error('Enter a quantity greater than zero');
        if (q > avail.get(p.id)) throw new Error(`Only ${fmtQty(p, avail.get(p.id))} available in your workshop stock`);
        await rpc('cjc_add_spare', { p_cjc_vehicle: cv.id, p_product: p.id, p_qty: q, p_note: note.value.trim() || null }); toast('Spare added'); m.close(); await reloadAll();
      }) })] });
  }

  /* ----- man-hours (multi-select) ----- */
  function manhoursCard() {
    const live = manhours.filter((m) => !m.voided); const total = live.reduce((a, m) => a + (new Date(m.end_ts) - new Date(m.start_ts)), 0);
    const t = dataTable({ exportName: 'cjc-manhours', hideToolbar: true, hideFooter: true, autoHeight: true, pageSize: 200, stack: true, rows: manhours, rowClass: (r) => (r.voided ? 'row-muted' : ''),
      columns: [
        { key: 'emp', label: 'Employee', value: (r) => employeeById(r.employee_id)?.name, render: (r) => h('div', null, h('div', { class: 'cell-main' }, employeeById(r.employee_id)?.name || '?'), h('div', { class: 'cell-sub' }, employeeById(r.employee_id)?.designation || '')) },
        { key: 'start_ts', label: 'Start', render: (r) => fmtDateTime(r.start_ts) }, { key: 'end_ts', label: 'End', render: (r) => fmtDateTime(r.end_ts) },
        { key: 'dur', label: 'Duration', value: (r) => new Date(r.end_ts) - new Date(r.start_ts), render: (r) => fmtDuration(new Date(r.end_ts) - new Date(r.start_ts)) },
        { key: 'x', label: '', sortable: false, render: (r) => (r.voided ? badge('Voided', 'danger', true) : canEdit && c.status === 'open' ? h('div', { class: 'actions' }, iconBtn('trash', 'Void entry', act(() => voidMh(r.id)))) : null) }],
      empty: { icon: 'clock', title: 'No man-hours booked', text: 'Add the employees who worked on these vehicles.' } });
    return card({ title: h('div', { class: 'row' }, h('h3', null, 'Man hours'), badge(`Total ${fmtDuration(total)}`, 'info', true)), cls: 'mb', flush: true,
      actions: canEdit && c.status === 'open' ? [btn('Add man hours', { cls: 'sm primary', icon: 'plus', onClick: addManhours })] : null, body: t.el });
  }
  async function voidMh(mid) { const r = await promptBox({ title: 'Void this entry', message: 'The entry stays on record, marked as voided.', label: 'Reason', tone: 'danger', confirmText: 'Void entry' }); if (!r) return; await rpc('cjc_void_manhour', { p_id: mid, p_reason: r }); toast('Entry voided', 'warn'); await reloadAll(); }

  async function addManhours() {
    const emps = S.employees.filter((e) => e.workshop_id === c.workshop_id && e.active);
    if (!emps.length) throw new Error('No active employees in this workshop. Ask the admin to add employees.');
    const picked = new Set(); const q = inp({ placeholder: 'Search employee...' }); const list = h('div', { style: { maxHeight: '240px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '8px' } }); const cnt = h('span', { class: 'badge b-info plain' }, '0 selected');
    const drawList = () => {
      const f = q.value.trim().toLowerCase(); const shown = emps.filter((e) => !f || `${e.name} ${e.emp_code} ${e.designation || ''}`.toLowerCase().includes(f));
      list.replaceChildren(...shown.map((e) => { const cb = h('input', { type: 'checkbox' }); cb.checked = picked.has(e.id); cb.onchange = () => { cb.checked ? picked.add(e.id) : picked.delete(e.id); cnt.textContent = `${picked.size} selected`; };
        return h('label', { class: 'row nowrap', style: { padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', gap: '10px' } }, cb, h('div', null, h('div', { class: 'bold' }, e.name), h('div', { class: 'small muted' }, `${e.emp_code}${e.designation ? ' · ' + e.designation : ''}`))); }));
      if (!shown.length) list.appendChild(h('div', { class: 'small muted', style: { padding: '12px' } }, 'No match'));
    };
    q.oninput = drawList; drawList();
    const now = new Date(); const s = inp({ type: 'datetime-local', value: toLocalInput(new Date(now - 3600000)) }); const e = inp({ type: 'datetime-local', value: toLocalInput(now) });
    const dur = h('div', { class: 'small muted' }); const upd = () => { const d = new Date(e.value) - new Date(s.value); dur.textContent = d >= 0 ? `Duration each: ${fmtDuration(d)}` : 'End must be after start'; }; s.oninput = e.oninput = upd; upd();
    const all = btn('Select all shown', { cls: 'sm', onClick: () => { const f = q.value.trim().toLowerCase(); emps.filter((x) => !f || `${x.name} ${x.emp_code} ${x.designation || ''}`.toLowerCase().includes(f)).forEach((x) => picked.add(x.id)); cnt.textContent = `${picked.size} selected`; drawList(); } });
    const none = btn('Clear', { cls: 'sm ghost', onClick: () => { picked.clear(); cnt.textContent = '0 selected'; drawList(); } });
    const m = modal({ title: 'Add man hours', content: h('div', { class: 'col' }, banner('info', 'Tick one or many employees and enter one start / end time. Each employee is saved as a separate entry.'),
      field('Employees', h('div', { class: 'col', style: { gap: '8px' } }, q, h('div', { class: 'row' }, all, none, h('div', { class: 'grow' }), cnt), list), { required: true }),
      h('div', { class: 'form-grid' }, field('Start', s, { required: true }), field('End', e, { required: true })), dur),
    foot: [btn('Cancel', { cls: '', onClick: () => m.close() }), btn('Save', { cls: 'primary', onClick: act(async () => {
      if (!picked.size) throw new Error('Select at least one employee');
      if (!s.value || !e.value || new Date(e.value) < new Date(s.value)) throw new Error('End time must be after the start time');
      if (new Date(e.value) > Date.now() + 300000) throw new Error('End time cannot be in the future');
      const n = await rpc('cjc_add_manhours', { p_id: id, p_employees: [...picked], p_start: fromLocalInput(s.value), p_end: fromLocalInput(e.value) });
      toast(`${n} man-hour entr${n === 1 ? 'y' : 'ies'} added`); m.close(); await reloadAll();
    }) })] });
  }

  /* ----- workflow ----- */
  async function doOpen() { if (!vehicles.length) throw new Error('Add at least one vehicle first'); const no = await rpc('cjc_open', { p_id: id }); toast(`Consumable job card ${no} created`); replacePath(`/cjc/${id}`); await reloadAll(); }
  async function delDraft() { if (!(await confirmBox({ title: 'Delete this draft?', message: 'The draft will be removed permanently.', tone: 'danger', confirmText: 'Delete draft' }))) return; canEdit = false; await rpc('cjc_discard', { p_id: id }); toast('Draft deleted'); navigate('/cjc'); }
  async function doComplete() {
    if (!manhours.some((m) => !m.voided)) throw new Error('Add at least one man-hour entry before completing');
    const lastEnd = manhours.filter((x) => !x.voided).reduce((a, x) => (new Date(x.end_ts) > a ? new Date(x.end_ts) : a), new Date(0));
    const ts = inp({ type: 'datetime-local', value: toLocalInput(new Date()), max: toLocalInput(new Date()), min: toLocalInput(lastEnd) });
    const m = modal({ title: 'Complete consumable job card', content: h('div', { class: 'col' }, banner('info', 'Completion sends the card to your workshop manager for approval.'), field('Completion date & time', ts, { required: true, hint: `Not in the future, and not earlier than the last man-hour end (${fmtDateTime(lastEnd)}).` })),
      foot: [btn('Cancel', { cls: '', onClick: () => m.close() }), btn('Mark as complete', { cls: 'success', onClick: act(async () => {
        if (!ts.value) throw new Error('Enter the completion time'); if (new Date(ts.value) > new Date(Date.now() + 60000)) throw new Error('Completion time cannot be in the future'); if (new Date(ts.value) < lastEnd) throw new Error(`Completion time cannot be earlier than the last man-hour end (${fmtDateTime(lastEnd)})`);
        await rpc('cjc_complete', { p_id: id, p_completed_at: fromLocalInput(ts.value) }); toast('Completed - sent for approval'); m.close(); await reloadAll();
      }) })] });
  }
  async function doFinalize() { if (!(await confirmBox({ title: 'Approve & finalize?', message: 'After finalizing, the card is locked. Later corrections must be reversed step by step.', confirmText: 'Finalize', tone: 'success' }))) return; await rpc('cjc_finalize', { p_id: id }); toast('Finalized'); await reloadAll(); }
  async function doSendBack() { const r = await promptBox({ title: 'Send back for correction', label: 'What needs to be corrected?', confirmText: 'Send back' }); if (!r) return; await rpc('cjc_send_back', { p_id: id, p_reason: r }); toast('Sent back to the workshop', 'warn'); await reloadAll(); }
  async function doReverse() { const r = await promptBox({ title: 'Reverse finalization', message: 'Returns to "Awaiting approval". The reason is written to the audit log.', label: 'Reason', tone: 'danger', confirmText: 'Reverse' }); if (!r) return; await rpc('cjc_reverse_finalize', { p_id: id, p_reason: r }); toast('Finalization reversed', 'warn'); await reloadAll(); }

  async function doPrint() {
    if (!vehicles.length) throw new Error('Add at least one vehicle before printing.');
    const live = manhours.filter((m) => !m.voided); const blank = (n, k) => Array.from({ length: n }, () => `<tr class="blankrow">${'<td></td>'.repeat(k)}</tr>`).join('');
    const vrows = vehicles.flatMap((cv) => { const v = vehicleById(cv.vehicle_id); const ss = spares.filter((s) => s.cjc_vehicle_id === cv.id);
      if (!ss.length) return [`<tr><td>${esc(v?.reg_no)}</td><td></td><td></td><td></td><td></td></tr>`];
      return ss.map((s, i) => { const p = productById(s.product_id); return `<tr><td>${i === 0 ? esc(v?.reg_no) : ''}</td><td>${esc(p?.description)}</td><td>${esc(p?.item_code)}</td><td class="num">${fmtNum(s.qty)}</td><td>${esc(p?.base_uom)}</td></tr>`; }); });
    const html = `${docHeader({ title: 'Consumable Job Card', no: c.cjc_no, status: c.status === 'draft' ? 'Draft' : c.status })}
      <div class="grid3">${box('Workshop', `<div class="big">${esc(wsName(c.workshop_id))}</div>${esc(wsById(c.workshop_id)?.address || '')}`)}${box('Created', `${esc(c.opened_at ? fmtDateTime(c.opened_at) : fmtDateTime(new Date()))}<br>${esc(userName(c.created_by))}`)}${box('Completed at', c.completed_at ? esc(fmtDateTime(c.completed_at)) : '<br>')}</div>
      ${c.remarks ? `<div class="note"><b>Remarks:</b> ${esc(c.remarks)}</div>` : ''}
      <table><thead><tr><th style="width:18%">Vehicle</th><th>Spare consumed</th><th>Item code</th><th class="num">Qty</th><th>Unit</th></tr></thead><tbody>${vrows.join('')}${blank(Math.max(2, 8 - vrows.length), 5)}</tbody></table>
      <table><thead><tr><th style="width:30%">Employee</th><th>Start</th><th>End</th><th class="num">Hours</th></tr></thead><tbody>
        ${live.map((m) => `<tr><td>${esc(employeeById(m.employee_id)?.name)}</td><td>${esc(fmtDateTime(m.start_ts))}</td><td>${esc(fmtDateTime(m.end_ts))}</td><td class="num">${fmtDuration(new Date(m.end_ts) - new Date(m.start_ts))}</td></tr>`).join('')}${blank(Math.max(3, 6 - live.length), 4)}</tbody></table>
      <div class="sig"><div>Mechanic</div><div>Supervisor</div><div>Workshop Manager</div><div></div></div>${docFooter(S.profile.full_name)}`;
    printPreview(c.cjc_no || 'Consumable job card', html);
  }

  await load(); await acquire(); draw();
  view.destroy = async () => {
    if (canEdit) {
      try { if (c.status === 'draft' && !vehicles.length && !(c.remarks || '').trim()) await rpc('cjc_discard', { p_id: id }); } catch { /* ignore */ }
      await unlockDoc('cjc', id);
    }
  };
  view.refresh = async () => { if (canEdit || document.querySelector('.overlay')) return; await load(); draw(); };
  return view;
}
