// Экспорт: TXT в формате платформы, Word (.docx, собирается из OOXML вручную), PNG и ZIP.
(function () {
  'use strict';
  const LETTERS = ['A', 'B', 'C', 'D', 'E'];
  const pad2 = n => String(n).padStart(2, '0');
  const xml = t => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Порядок вопросов: тест 1..5, внутри — как в тесте; сквозная нумерация 1–25
  function ordered(set) {
    return set.questions.slice().sort((a, b) => a.test - b.test || a.pos - b.pos);
  }
  const imgName = (n, opt) => (opt == null ? `q${pad2(n)}.png` : `q${pad2(n)}_${'abcde'[opt]}.png`);

  function tag(set, file) {
    if (set.settings.imgTag === false) return '';
    return ' ' + (set.settings.imgTemplate || '[img:{file}]').replace('{file}', file);
  }

  function buildTxt(set) {
    const lines = [];
    ordered(set).forEach((q, i) => {
      const n = i + 1;
      lines.push(`${n}. ${oneLine(q.text)}${q.figure ? tag(set, imgName(n)) : ''}`);
      q.options.forEach((o, k) => lines.push(`${k === q.correct ? '(!)' : '(?)'} ${oneLine(o.text || '')}${o.figure ? tag(set, imgName(n, k)) : ''}`.replace(/\s+$/, '').replace(/^(\(.\))\s+/, '$1 ')));
      lines.push('');
    });
    return lines.join('\r\n');
  }
  const oneLine = t => String(t || '').replace(/\s*\n\s*/g, ' ').trim();

  async function renderImages(set) {
    const out = []; // {name, blob, width, height, n, opt}
    const list = ordered(set);
    for (let i = 0; i < list.length; i++) {
      const q = list[i], n = i + 1;
      if (q.figure) {
        const r = Figure.render(q.figure);
        out.push(Object.assign({ name: imgName(n), n, opt: null }, await Figure.svgToPng(r.svg, 1600)));
      }
      for (let k = 0; k < q.options.length; k++) {
        const o = q.options[k];
        if (!o.figure) continue;
        const r = Figure.render(o.figure, { small: true });
        out.push(Object.assign({ name: imgName(n, k), n, opt: k }, await Figure.svgToPng(r.svg, 960)));
      }
    }
    return out;
  }

  // ---------- Word ----------
  function runs(text, rp = '') {
    // ^…^ — верхний индекс, ~…~ — нижний
    const out = []; const re = /\^([^^]+)\^|~([^~]+)~/g; let last = 0, m;
    const r = (t, extra) => t ? `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/>${rp}${extra || ''}</w:rPr><w:t xml:space="preserve">${xml(t)}</w:t></w:r>` : '';
    text = String(text || '');
    while ((m = re.exec(text))) {
      out.push(r(text.slice(last, m.index)));
      out.push(r(m[1] || m[2], `<w:vertAlign w:val="${m[1] ? 'superscript' : 'subscript'}"/>`));
      last = re.lastIndex;
    }
    out.push(r(text.slice(last)));
    return out.join('');
  }
  function para(inner, o = {}) {
    const ppr = [o.pageBreak ? '<w:pageBreakBefore/>' : '', o.keepNext ? '<w:keepNext/>' : '', o.keepLines ? '<w:keepLines/>' : '',
      `<w:spacing w:before="${o.before || 0}" w:after="${o.after == null ? 80 : o.after}"/>`, o.jc ? `<w:jc w:val="${o.jc}"/>` : '',
      o.shd ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shd}"/>` : '', o.ind ? `<w:ind w:left="${o.ind}"/>` : ''].join('');
    return `<w:p><w:pPr>${ppr}</w:pPr>${inner}</w:p>`;
  }
  function drawing(rId, id, cx, cy, name) {
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${name}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }

  async function buildDocx(set, images) {
    const L = set.labelsResolved;
    const media = [], rels = [];
    let rid = 10, did = 1;
    const imgRef = (im, maxCm, maxHcm) => {
      const r = 'rId' + (rid++);
      media.push({ path: 'word/media/' + im.name, blob: im.blob });
      rels.push(`<Relationship Id="${r}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${im.name}"/>`);
      const EMUcm = 360000;
      let cx = maxCm * EMUcm, cy = cx * im.height / im.width;
      if (cy > maxHcm * EMUcm) { cy = maxHcm * EMUcm; cx = cy * im.width / im.height; }
      return drawing(r, did++, Math.round(cx), Math.round(cy), im.name);
    };
    const byName = {}; images.forEach(im => { byName[im.name] = im; });
    const body = [];
    const a = set.analysis || {};
    const list = ordered(set);

    body.push(para(runs(a.topic || set.topic || L.subject, '<w:b/><w:sz w:val="36"/>'), { after: 120 }));
    body.push(para(runs(`${L.subject} · ${set.grade} ${L.grade} · ${list.length} ${L.questions} · ${Math.max(...list.map(q => q.test))} ${L.tests}`, '<w:color w:val="555555"/>'), { after: 60 }));
    if (set.videoUrl) body.push(para(runs(`${L.video}: ${set.videoUrl}`, '<w:color w:val="1F6FD6"/>'), { after: 120 }));

    let curTest = 0;
    list.forEach((q, i) => {
      const n = i + 1;
      if (q.test !== curTest) {
        curTest = q.test;
        body.push(para(runs(`${L.test} ${curTest}`, '<w:b/><w:sz w:val="32"/>'), { pageBreak: true, after: 200 }));
      }
      body.push(para(runs(`${n}. `, '<w:b/>') + runs(`(${L.levels[q.level] || q.level}) `, '<w:color w:val="888888"/><w:sz w:val="18"/>') + runs(q.text), { keepNext: true, before: 200, after: 100 }));
      if (q.figure && byName[imgName(n)]) body.push(para(imgRef(byName[imgName(n)], 12, 9), { keepNext: true, after: 100 }));
      const optHasFig = q.options.some(o => o.figure);
      if (optHasFig) {
        // таблица 3 + 2, строки не разрываются
        const cell = k => {
          const o = q.options[k], ok = k === q.correct;
          const head = runs(`${LETTERS[k]}) ${o.text || ''}${ok ? ' ✓' : ''}`, ok ? '<w:b/><w:color w:val="1E8E3E"/>' : '<w:b/>');
          const img = o.figure && byName[imgName(n, k)] ? para(imgRef(byName[imgName(n, k)], 5, 4.2), { after: 0 }) : '';
          return `<w:tc><w:tcPr><w:tcW w:w="3200" w:type="dxa"/>${ok ? '<w:shd w:val="clear" w:color="auto" w:fill="E6F4EA"/>' : ''}</w:tcPr>${para(head, { after: 40, keepNext: true })}${img || para('')}</w:tc>`;
        };
        const row = ks => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${ks.map(cell).join('')}${ks.length < 3 ? '<w:tc><w:tcPr><w:tcW w:w="3200" w:type="dxa"/></w:tcPr><w:p/></w:tc>' : ''}</w:tr>`;
        body.push(`<w:tbl><w:tblPr><w:tblW w:w="9600" w:type="dxa"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="3200"/><w:gridCol w:w="3200"/><w:gridCol w:w="3200"/></w:tblGrid>${row([0, 1, 2])}${row([3, 4])}</w:tbl>`);
      } else {
        q.options.forEach((o, k) => {
          const ok = k === q.correct;
          body.push(para(runs(`${LETTERS[k]}) `, '<w:b/>' + (ok ? '<w:color w:val="1E8E3E"/>' : '')) + runs(o.text, ok ? '<w:b/><w:color w:val="1E8E3E"/>' : '') + (ok ? runs(' ✓', '<w:b/><w:color w:val="1E8E3E"/>') : ''),
            { ind: 360, after: 40, keepNext: k < 4, shd: ok ? 'E6F4EA' : null }));
        });
      }
      if (set.settings.solutions !== false && q.solution) body.push(para(runs(`${L.solution}: `, '<w:i/><w:b/><w:color w:val="555555"/><w:sz w:val="20"/>') + runs(q.solution, '<w:i/><w:color w:val="555555"/><w:sz w:val="20"/>'), { before: 60, after: 120 }));
    });

    // ключ ответов
    body.push(para(runs(L.key, '<w:b/><w:sz w:val="32"/>'), { pageBreak: true, after: 200 }));
    const tests = [...new Set(list.map(q => q.test))];
    const kcell = (t, w, b, fill) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}</w:tcPr>${para(runs(t, b ? '<w:b/>' : ''), { after: 0, jc: 'center' })}</w:tc>`;
    const krows = tests.map(t => {
      const qs = list.map((q, i) => ({ q, n: i + 1 })).filter(x => x.q.test === t);
      return `<w:tr>${kcell(`${L.test} ${t}`, 1800, true, 'F2F2F7')}${qs.map(x => kcell(`${x.n} — ${LETTERS[x.q.correct]}`, 1560, false)).join('')}</w:tr>`;
    }).join('');
    const bd = 'w:val="single" w:sz="4" w:color="BBBBBB"';
    body.push(`<w:tbl><w:tblPr><w:tblW w:w="9600" w:type="dxa"/><w:tblBorders><w:top ${bd}/><w:left ${bd}/><w:bottom ${bd}/><w:right ${bd}/><w:insideH ${bd}/><w:insideV ${bd}/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="1800"/>${'<w:gridCol w:w="1560"/>'.repeat(5)}</w:tblGrid>${krows}</w:tbl>`);

    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="${set.lang === 'kk' ? 'kk-KZ' : 'ru-RU'}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
    const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels.join('')}</Relationships>`;
    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(a.topic || set.topic || 'Геометрия')}</dc:title><dc:creator>oilau.kz</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`;

    const zip = new JSZip();
    zip.file('[Content_Types].xml', ct);
    zip.file('_rels/.rels', rootRels);
    zip.file('docProps/core.xml', core);
    zip.file('word/document.xml', doc);
    zip.file('word/styles.xml', styles);
    zip.file('word/_rels/document.xml.rels', docRels);
    media.forEach(m => zip.file(m.path, m.blob));
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  function baseName(set) {
    const t = ((set.analysis && set.analysis.topic) || set.topic || 'geometry').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 50);
    return `${set.grade}kl_${t}`;
  }

  function download(blob, name) {
    // на claude.ai файл отдаётся через возможность downloads (см. app.js)
    if (window.Exporter.saver) return window.Exporter.saver(blob, name);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function exportFile(set, kind) {
    const name = baseName(set);
    if (kind === 'txt') return download(new Blob([buildTxt(set)], { type: 'text/plain;charset=utf-8' }), name + '.txt');
    const images = await renderImages(set);
    if (kind === 'docx') return download(await buildDocx(set, images), name + '.docx');
    const zip = new JSZip();
    const folder = zip.folder('images');
    images.forEach(im => folder.file(im.name, im.blob));
    if (kind === 'images') return download(await zip.generateAsync({ type: 'blob' }), name + '_images.zip');
    zip.file(name + '.docx', await buildDocx(set, images));
    zip.file(name + '.txt', buildTxt(set));
    return download(await zip.generateAsync({ type: 'blob' }), name + '.zip');
  }

  window.Exporter = { exportFile, buildTxt, ordered };
})();
