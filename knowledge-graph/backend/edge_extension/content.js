(() => {
  const text = value => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 4 && rect.height > 4;
  };

  function nearestTitle(table, index) {
    if (table.caption && text(table.caption.textContent)) return text(table.caption.textContent);
    let node = table.previousElementSibling;
    for (let step = 0; node && step < 5; step += 1, node = node.previousElementSibling) {
      if (/^H[1-6]$/.test(node.tagName) && text(node.textContent)) return text(node.textContent);
    }
    return `可见表格 ${index + 1}`;
  }

  function inferDatasetType(headers) {
    const joined = headers.join('|');
    if (/股东|持股|出资比例|股权/.test(joined)) return 'equity_structure';
    if (/姓名|人员/.test(joined) && /职务|职位|任职/.test(joined)) return 'executive_profile';
    if (/供应商|采购金额|采购占比/.test(joined)) return 'supplier_customer';
    if (/客户|销售金额|销售占比/.test(joined)) return 'supplier_customer';
    if (/关联企业|企业名称|关联关系/.test(joined)) return 'related_entity';
    if (/案号|案由|法院|涉案金额/.test(joined)) return 'litigation_event';
    if (/处罚|监管|决定文书|处罚机关/.test(joined)) return 'regulatory_event';
    return 'visible_table';
  }

  function readTable(table, index) {
    const rows = [...table.querySelectorAll('tr')].filter(visible);
    if (!rows.length) return null;
    let headers = [...rows[0].querySelectorAll('th')].map(cell => text(cell.innerText));
    let start = 1;
    if (!headers.length) {
      headers = [...rows[0].querySelectorAll('td')].map((cell, column) => text(cell.innerText) || `列${column + 1}`);
      start = 1;
    }
    headers = headers.map((header, column) => header || `列${column + 1}`);
    const data = rows.slice(start).map((row, rowIndex) => {
      const cells = [...row.querySelectorAll('th,td')].map(cell => text(cell.innerText));
      const record = { _visible_row: rowIndex + 1 };
      headers.forEach((header, column) => { record[header] = cells[column] || ''; });
      return record;
    }).filter(record => Object.entries(record).some(([key, value]) => key !== '_visible_row' && value));
    if (!data.length) return null;
    return {
      table_index: index,
      table_title: nearestTitle(table, index),
      headers,
      inferred_dataset_type: inferDatasetType(headers),
      rows: data,
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'RISK_KG_CAPTURE_VISIBLE_TABLES') return false;
    try {
      const tables = [...document.querySelectorAll('table')]
        .filter(visible)
        .map(readTable)
        .filter(Boolean);
      sendResponse({
        ok: true,
        page_url: location.href,
        page_title: document.title,
        captured_at: new Date().toISOString(),
        tables,
      });
    } catch (error) {
      sendResponse({ ok: false, error: String(error?.message || error) });
    }
    return true;
  });
})();
