// Data table: search, filters, sortable sticky header, pagination, CSV export, selection, mobile cards
import { h, icon, clear, hl, emptyState, searchInput } from './ui.js';
import { selectBox } from './select.js';
import { cmp, downloadFile, toCSV, debounce } from './format.js';

/**
 * dataTable({
 *   columns:[{key,label,value?(row),render?(row,q),num?,sortable?=true,exportable?=true,cls?,sticky?}],
 *   rows, rowKey='id', filters:[{key,label,options?,value?(row),test?(row,val)}],
 *   defaultSort:{key,dir}, pageSize=25, rowClass?(row), onRowClick?(row), empty:{...},
 *   exportName, toolbar:[nodes], footer?(rows)=>Node, selectable, onSelect?(ids), flush
 * }) => { el, setRows, getRows, getView, selected(), clearSelection(), refresh() }
 */
export function dataTable(opts) {
  const o = { rowKey: 'id', pageSize: 25, filters: [], toolbar: [], ...opts };
  let rows = o.rows || [];
  let q = ''; let sort = o.defaultSort ? { ...o.defaultSort } : null; let page = 1; let size = o.pageSize;
  const fvals = {}; const sel = new Set();

  const cols = o.columns.filter((c) => !c.hidden);
  const val = (c, r) => (c.value ? c.value(r) : r[c.key]);
  const searchText = (r) => (o.searchText ? o.searchText(r) : cols.map((c) => { const v = val(c, r); return v === null || v === undefined ? '' : String(v); }).join(' ')).toLowerCase();

  const search = searchInput({ placeholder: o.searchPlaceholder || 'Search...', onInput: debounce((e) => { q = e.target.value; page = 1; draw(); }, 180) });
  const filterEls = o.filters.map((f) => {
    const sb = selectBox({ options: [], placeholder: f.label, small: true, onChange: (v) => { fvals[f.key] = v; page = 1; draw(); } });
    sb._f = f; return sb;
  });
  const refreshFilterOptions = () => filterEls.forEach((sb) => {
    const f = sb._f;
    let op = typeof f.options === 'function' ? f.options(rows) : f.options;
    if (!op) {
      const set = new Set(rows.map((r) => (f.value ? f.value(r) : r[f.key])).filter((v) => v !== null && v !== undefined && v !== ''));
      op = [...set].sort(cmp).map((v) => ({ value: v, label: String(v) }));
    }
    sb.setOptions(op, true);
  });

  const exportBtn = o.exportName !== false ? h('button', { class: 'btn sm', onClick: () => exportCSV(), title: 'Download as CSV' }, icon('download'), 'Export') : null;
  const toolbar = h('div', { class: 'toolbar' }, h('div', { class: 'search' }, search),
    filterEls.length ? h('div', { class: 'filters' }, filterEls) : null,
    h('div', { class: 'spacer' }, o.toolbar, exportBtn));
  const tbody = h('tbody'); const thead = h('thead'); const tfoot = h('tfoot');
  const table = h('table', { class: `dt${o.stack === false ? '' : ' stack'}` }, thead, tbody, tfoot);
  const wrap = h('div', { class: `table-wrap${o.autoHeight ? ' auto' : ''}` }, table);
  const info = h('div', { class: 'small' }); const pager = h('div', { class: 'pager' });
  const foot = h('div', { class: 'table-foot' }, info, pager);
  const el = h('div', { class: o.flush === false ? 'card' : '' }, o.hideToolbar ? null : toolbar, wrap, o.hideFooter ? null : foot);
  if (o.flush !== false) { /* embedded in card by caller */ }

  const view = () => {
    let r = rows;
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length) r = r.filter((x) => { const s = searchText(x); return terms.every((t) => s.includes(t)); });
    o.filters.forEach((f) => {
      const v = fvals[f.key]; if (v === null || v === undefined || v === '') return;
      r = r.filter((x) => (f.test ? f.test(x, v) : String(f.value ? f.value(x) : x[f.key]) === String(v)));
    });
    if (sort) {
      const c = cols.find((x) => x.key === sort.key);
      if (c) { const d = sort.dir === 'desc' ? -1 : 1; r = [...r].sort((a, b) => d * cmp(val(c, a), val(c, b))); }
    }
    return r;
  };

  function drawHead() {
    clear(thead);
    const tr = h('tr');
    if (o.selectable) {
      const all = h('input', { type: 'checkbox', title: 'Select all', onChange: (e) => { const v = view(); v.forEach((r) => (e.target.checked ? sel.add(r[o.rowKey]) : sel.delete(r[o.rowKey]))); draw(); o.onSelect && o.onSelect([...sel]); } });
      all.id = 'sel-all'; tr.appendChild(h('th', { style: { width: '40px' } }, all));
    }
    cols.forEach((c) => {
      const s = c.sortable !== false;
      const sorted = sort && sort.key === c.key;
      tr.appendChild(h('th', { class: `${s ? 'sortable' : ''}${sorted ? ' sorted' : ''}${c.num ? ' num' : ''}${c.sticky ? ' sticky-l' : ''} ${c.cls || ''}`, onClick: s ? () => {
        if (!sort || sort.key !== c.key) sort = { key: c.key, dir: 'asc' }; else if (sort.dir === 'asc') sort = { key: c.key, dir: 'desc' }; else sort = null;
        draw();
      } : null }, c.label, s ? h('span', { class: 'sort' }, icon(sorted ? (sort.dir === 'asc' ? 'chevUp' : 'chevDown') : 'updown')) : null));
    });
    thead.appendChild(tr);
  }

  function draw() {
    refreshAll = false;
    drawHead();
    const all = view();
    const total = all.length; const pages = Math.max(1, Math.ceil(total / size));
    if (page > pages) page = pages;
    const slice = all.slice((page - 1) * size, page * size);
    clear(tbody);
    if (!slice.length) {
      const e = o.empty || {};
      tbody.appendChild(h('tr', null, h('td', { colspan: cols.length + (o.selectable ? 1 : 0), style: { padding: 0 }, 'data-label': '' },
        emptyState({ icon: e.icon || 'inbox', title: rows.length ? 'No matching records' : (e.title || 'No records yet'), text: rows.length ? 'Try changing the search or filters.' : (e.text || ''), action: rows.length ? null : e.action }))));
    }
    slice.forEach((r) => {
      const tr = h('tr', { class: `${o.onRowClick ? 'clickable ' : ''}${o.rowClass ? o.rowClass(r) || '' : ''}`, onClick: o.onRowClick ? (ev) => { if (ev.target.closest('button, a, input, .select, label')) return; o.onRowClick(r); } : null });
      if (o.selectable) {
        tr.appendChild(h('td', { 'data-label': '' }, h('input', { type: 'checkbox', checked: sel.has(r[o.rowKey]), onChange: (e) => { e.target.checked ? sel.add(r[o.rowKey]) : sel.delete(r[o.rowKey]); o.onSelect && o.onSelect([...sel]); } })));
      }
      cols.forEach((c) => {
        const td = h('td', { class: `${c.num ? 'num ' : ''}${c.sticky ? 'sticky-l ' : ''}${c.cls || ''}`, 'data-label': c.label || '' });
        if (c.render) { const out = c.render(r, q); if (out !== null && out !== undefined) (out instanceof Node ? td.appendChild(out) : td.append(String(out))); }
        else { const v = val(c, r); td.appendChild(q && typeof v === 'string' ? hl(v, q) : document.createTextNode(v === null || v === undefined || v === '' ? '—' : String(v))); }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    clear(tfoot);
    if (o.footer && total) { const f = o.footer(all); if (f) tfoot.appendChild(f); }
    info.textContent = total ? `Showing ${(page - 1) * size + 1}–${Math.min(total, page * size)} of ${total}${total !== rows.length ? ` (filtered from ${rows.length})` : ''}` : '0 records';
    clear(pager);
    const sizeSel = selectBox({ options: [10, 25, 50, 100, 250].map((n) => ({ value: n, label: `${n} / page` })), value: size, clearable: false, searchable: false, small: true, onChange: (v) => { size = v; page = 1; draw(); } });
    sizeSel.style.width = '120px';
    pager.append(sizeSel,
      h('button', { class: 'btn sm icon', disabled: page <= 1, onClick: () => { page--; draw(); }, title: 'Previous' }, icon('chevLeft')),
      h('span', null, `Page ${page} / ${pages}`),
      h('button', { class: 'btn sm icon', disabled: page >= pages, onClick: () => { page++; draw(); }, title: 'Next' }, icon('chevRight')));
    const sa = thead.querySelector('#sel-all'); if (sa) { sa.checked = slice.length > 0 && slice.every((r) => sel.has(r[o.rowKey])); }
  }
  let refreshAll = true;

  function exportCSV() {
    const ex = cols.filter((c) => c.exportable !== false && c.label);
    const data = [ex.map((c) => c.label), ...view().map((r) => ex.map((c) => { const v = c.exportValue ? c.exportValue(r) : val(c, r); return v instanceof Date ? v.toISOString() : v; }))];
    downloadFile(`${o.exportName || 'export'}-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(data));
  }

  refreshFilterOptions(); draw();
  return {
    el,
    setRows(r) { rows = r || []; refreshFilterOptions(); draw(); },
    getRows: () => rows, getView: view,
    selected: () => [...sel], clearSelection() { sel.clear(); draw(); o.onSelect && o.onSelect([]); },
    refresh: draw,
    setFilter(k, v) { fvals[k] = v; const sb = filterEls.find((s) => s._f.key === k); sb && sb.setValue(v, true); page = 1; draw(); },
    setSearch(s) { q = s; search.querySelector('input').value = s; draw(); },
  };
}
