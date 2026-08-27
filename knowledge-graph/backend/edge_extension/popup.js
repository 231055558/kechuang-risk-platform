const company = document.getElementById('company');
const sourceAccess = document.getElementById('sourceAccess');
const captureButton = document.getElementById('capture');
const sendButton = document.getElementById('send');
const downloadButton = document.getElementById('download');
const tablesRoot = document.getElementById('tables');
const status = document.getElementById('status');
let capture = null;

const esc = value => String(value || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const types = [
  ['supplier_customer','供应商/客户'],['equity_structure','股东/股权'],
  ['executive_profile','高管/核心人员'],['related_entity','关联企业'],
  ['litigation_event','诉讼事件'],['regulatory_event','监管事件'],['visible_table','其他可见表格'],
];

function selectedPayload() {
  if (!capture) return null;
  const selected = [...tablesRoot.querySelectorAll('.table')].filter(card => card.querySelector('input').checked);
  return {
    ...capture,
    company: company.value.trim(),
    capture_source: 'edge_visible_table_extension',
    source_access: sourceAccess.value,
    review_required: true,
    tables: selected.map(card => {
      const index = Number(card.dataset.index);
      return {...capture.tables[index], dataset_type: card.querySelector('select').value};
    }),
  };
}

function render() {
  tablesRoot.innerHTML = '';
  (capture?.tables || []).forEach((table, index) => {
    const card = document.createElement('article');
    card.className = 'table';
    card.dataset.index = index;
    card.innerHTML = `<div class="table-head"><input type="checkbox" checked><strong>${esc(table.table_title)}</strong><span class="meta">${table.rows.length} 行</span></div><label>数据类型<select>${types.map(([value,label])=>`<option value="${value}" ${value===table.inferred_dataset_type?'selected':''}>${label}</option>`).join('')}</select></label><div class="meta">字段：${esc(table.headers.slice(0,8).join('、'))}</div>`;
    tablesRoot.appendChild(card);
  });
  const enabled = Boolean(capture?.tables?.length);
  sendButton.disabled = !enabled;
  downloadButton.disabled = !enabled;
}

captureButton.addEventListener('click', async () => {
  status.textContent = '正在读取当前可见表格...';
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  if (!tab?.id) { status.textContent = '找不到当前活动页面。'; return; }
  try {
    capture = await chrome.tabs.sendMessage(tab.id, {type:'RISK_KG_CAPTURE_VISIBLE_TABLES'});
    if (!capture?.ok) throw new Error(capture?.error || '采集失败');
    render();
    status.textContent = capture.tables.length ? `发现 ${capture.tables.length} 个可见表格，请确认后提交。` : '当前页面没有可见 HTML 表格。';
  } catch (error) {
    status.textContent = `无法采集：${error.message || error}`;
  }
});

sendButton.addEventListener('click', async () => {
  const payload = selectedPayload();
  if (!payload?.company) { status.textContent = '请填写目标企业。'; return; }
  status.textContent = '正在发送到 127.0.0.1:8770...';
  try {
    const response = await fetch('http://127.0.0.1:8770/capture', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '接收器返回错误');
    status.textContent = `已保存 ${result.record_count} 条记录；${result.invalid_count} 条需要补字段。`;
  } catch (error) {
    status.textContent = `发送失败：${error.message || error}。请先启动本地接收器。`;
  }
});

downloadButton.addEventListener('click', () => {
  const payload = selectedPayload();
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
  chrome.downloads.download({url,filename:`risk-kg-edge-capture-${Date.now()}.json`,saveAs:true},()=>setTimeout(()=>URL.revokeObjectURL(url),5000));
});
