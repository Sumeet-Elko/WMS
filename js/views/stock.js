import { sb, watch } from '../db.js';
import { getState } from '../auth.js';
import { esc, fmtDate, fmtQty, table, openForm, toast } from '../ui.js';
import { inScope, fail, isStoreUser } from '../doc.js';

export async function render(root) {
  const st = getState(), p = st.profile;
  const isAdmin = p.role === 'admin';
  const showStore = isAdmin || p.locations?.type === 'store';
  const showFloor = isAdmin || p.locations?.type === 'workshop';
  root.innerHTML = `<div class="head"><h2>${isAdmin ? 'Stock' : showStore ? 'Store Stock' : 'Floor Stock'}</h2><div class="btns">
      <input type="search" id="q" placeholder="Search item…">
      ${p.role === 'stores_head' ? '<button class="btn" id="in">+ Receive stock</button>' : ''}</div></div>
    ${showStore ? '<h3>Store stock</h3><div id="ss"></div><h3>Recent store movements</h3><div id="sl"></div>' : ''}
    ${showFloor ? '<h3>Workshop floor stock ("Existing Stock")</h3><div id="fs"></div><h3>Recent floor movements</h3><div id="fl"></div>' : ''}`;
  let data = {};
  const q = () => root.querySelector('#q').value.trim().toLowerCase();
  const hit = (r) => !q() || `${r.product?.item_code} ${r.product?.item_name}`.toLowerCase().includes(q());

  function draw() {
    const nm = (r) => `${esc(r.product?.item_code)} · ${esc(r.product?.item_name)}`;
    if (showStore) {
      root.querySelector('#ss').innerHTML = table(['Store', 'Item', 'Balance (base UOM)', 'Purchase UOM equiv.'],
        (data.ss || []).filter((r) => inScope(r.store_id) && hit(r)).map((r) => `<tr><td>${esc(r.loc?.code)}</td><td>${nm(r)}</td>
          <td>${fmtQty(r.qty_base)} ${esc(r.product?.base_uom)}</td><td>${fmtQty(r.qty_base / r.product?.uoq)} ${esc(r.product?.purchase_uom)}</td></tr>`), 'No stock recorded yet');
      root.querySelector('#sl').innerHTML = table(['When', 'Item', 'Change', 'Reason', 'Ref'],
        (data.sl || []).filter((r) => inScope(r.store_id) && hit(r)).slice(0, 40).map((r) => `<tr><td>${fmtDate(r.at)}</td><td>${nm(r)}</td>
          <td class="${r.qty_base < 0 ? 'neg' : 'pos'}">${r.qty_base > 0 ? '+' : ''}${fmtQty(r.qty_base)}</td><td>${esc(r.reason)}</td><td>${esc(r.ref || '')}</td></tr>`));
    }
    if (showFloor) {
      root.querySelector('#fs').innerHTML = table(['Workshop', 'Item', 'Balance (base UOM)'],
        (data.fs || []).filter((r) => inScope(r.workshop_id) && hit(r)).map((r) => `<tr><td>${esc(r.loc?.code)}</td><td>${nm(r)}</td><td>${fmtQty(r.qty_base)} ${esc(r.product?.base_uom)}</td></tr>`),
        'No floor stock yet. Leftover MRF spares can be moved here from a Delivery Challan.');
      root.querySelector('#fl').innerHTML = table(['When', 'Item', 'Change', 'Reason', 'Ref'],
        (data.fl || []).filter((r) => inScope(r.workshop_id) && hit(r)).slice(0, 40).map((r) => `<tr><td>${fmtDate(r.at)}</td><td>${nm(r)}</td>
          <td class="${r.qty_base < 0 ? 'neg' : 'pos'}">${r.qty_base > 0 ? '+' : ''}${fmtQty(r.qty_base)}</td><td>${esc(r.reason)}</td><td>${esc(r.ref || '')}</td></tr>`));
    }
  }
  async function load() {
    const P = 'product:products(item_code,item_name,base_uom,purchase_uom,uoq)';
    const jobs = [];
    if (showStore) jobs.push(sb.from('store_stock').select(`*, ${P}, loc:locations!store_id(code)`).then((r) => (data.ss = r.data)),
      sb.from('stock_ledger').select(`*, ${P}`).order('at', { ascending: false }).limit(150).then((r) => (data.sl = r.data)));
    if (showFloor) jobs.push(sb.from('floor_stock').select(`*, ${P}, loc:locations!workshop_id(code)`).then((r) => (data.fs = r.data)),
      sb.from('floor_stock_ledger').select(`*, ${P}`).order('at', { ascending: false }).limit(150).then((r) => (data.fl = r.data)));
    await Promise.all(jobs); draw();
  }
  root.querySelector('#q').oninput = draw;
  const inBtn = root.querySelector('#in');
  if (inBtn) inBtn.onclick = async () => {
    const { data: prods } = await sb.from('products').select('id,item_code,item_name,purchase_uom,base_uom,uoq').eq('is_active', true).eq('type', 'Product').order('item_name');
    const v = await openForm({ title: 'Receive stock', submitText: 'Add to stock', fields: [
      { name: 'product_id', label: 'Product', type: 'select', required: true, search: true,
        options: [{ value: '', label: '— choose —' }, ...(prods || []).map((x) => ({ value: x.id, label: `${x.item_code} · ${x.item_name} — 1 ${x.purchase_uom} = ${fmtQty(x.uoq)} ${x.base_uom}` }))] },
      { name: 'qty', label: 'Quantity in PURCHASE UOM (e.g. barrels)', type: 'number', required: true,
        hint: 'It is converted to the Base UOM automatically using the product\'s conversion.' },
      { name: 'ref', label: 'Reference (invoice / GRN no.)' }] });
    if (!v) return;
    const { data, error } = await sb.rpc('stock_in', { p_product: v.product_id, p_purchase_qty: v.qty, p_ref: v.ref });
    error ? fail(error) : toast(`Added ${fmtQty(data)} in base UOM`, 'ok');
  };
  await load();
  ['store_stock', 'floor_stock'].forEach((t) => watch(t, load));
}
