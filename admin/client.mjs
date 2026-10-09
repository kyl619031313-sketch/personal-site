// Serialized into the existing inline-script CSP; no remote renderer or dependencies.
export function client() {
  const esc = s =>
    s.replace(
      /[&<>"']/g,
      c =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c]
    );
  function inline(source) {
    const codes = [];
    let text = esc(source).replace(
      /`([^`]+)`/g,
      (_, value) =>
        '\u0000' + (codes.push('<code>' + value + '</code>') - 1) + '\u0000'
    );
    text = text.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (_, label, href) =>
      /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(href)
        ? `<a href="${href}" target="_blank" rel="noopener">${label}</a>`
        : label
    );
    return text
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\u0000(\d+)\u0000/g, (_, i) => codes[i]);
  }
  function markdown(source) {
    const lines = source.replace(/\r/g, '').split('\n');
    const out = [];
    for (let i = 0; i < lines.length;) {
      const line = lines[i];
      if (!line.trim()) {
        i++;
        continue;
      }
      if (/^```/.test(line)) {
        const code = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i]))
          code.push(lines[i++]);
        i++;
        out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
        continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.+)/);
      if (heading) {
        out.push(
          `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`
        );
        i++;
        continue;
      }
      if (/^>\s?/.test(line)) {
        const quote = [];
        while (i < lines.length && /^>\s?/.test(lines[i]))
          quote.push(lines[i++].replace(/^>\s?/, ''));
        out.push('<blockquote>' + markdown(quote.join('\n')) + '</blockquote>');
        continue;
      }
      const list = line.match(/^\s*(?:([-*+])|\d+\.)\s+(.+)/);
      if (list) {
        const tag = list[1] ? 'ul' : 'ol';
        const items = [];
        const pattern = tag === 'ul' ? /^\s*[-*+]\s+(.+)/ : /^\s*\d+\.\s+(.+)/;
        while (i < lines.length && pattern.test(lines[i]))
          items.push('<li>' + inline(lines[i++].match(pattern)[1]) + '</li>');
        out.push(`<${tag}>${items.join('')}</${tag}>`);
        continue;
      }
      const paragraph = [line];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{1,6}\s|```|>|\s*[-*+]\s|\s*\d+\.\s)/.test(lines[i])
      )
        paragraph.push(lines[i++]);
      out.push(
        '<p>' + inline(paragraph.join('\n')).replace(/\n/g, '<br>') + '</p>'
      );
    }
    return out.join('');
  }
  const grow = area => {
    area.style.height = 'auto';
    area.style.height = area.scrollHeight + 2 + 'px';
  };
  document.querySelectorAll('textarea').forEach(area => {
    grow(area);
    area.addEventListener('input', () => grow(area));
  });
  const form = document.querySelector('form[data-editor]');
  if (form) {
    const snapshot = () => new URLSearchParams(new FormData(form)).toString();
    const initial = snapshot();
    let submitting = false;
    // List operations return an unsaved session draft; keep warning across those responses.
    const drafted = form.hasAttribute('data-draft');
    window.addEventListener('beforeunload', event => {
      if (!submitting && (drafted || initial !== snapshot())) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    form.addEventListener('submit', event => {
      submitting = true;
      if (event.submitter?.name === 'operation') return;
      document.querySelectorAll('[data-save]').forEach(button => {
        button.disabled = true;
        button.innerHTML =
          '<span class="spinner" aria-hidden="true"></span>正在保存…';
      });
      form.setAttribute('aria-busy', 'true');
    });
    window.addEventListener('pageshow', () => {
      submitting = false;
      form.removeAttribute('aria-busy');
      document.querySelectorAll('[data-save]').forEach(button => {
        button.disabled = false;
        button.textContent = '保存并发布';
      });
    });
  }
  const body = document.getElementById('body');
  if (body) {
    const edit = document.getElementById('edit-tab');
    const preview = document.getElementById('preview-tab');
    const select = show => {
      edit.setAttribute('aria-selected', String(!show));
      preview.setAttribute('aria-selected', String(show));
      document.getElementById('edit-panel').hidden = show;
      const panel = document.getElementById('preview-panel');
      panel.hidden = !show;
      if (show)
        panel.innerHTML =
          markdown(body.value) ||
          '<p class="muted">填写正文后，这里会显示预览。</p>';
      else grow(body);
    };
    body.addEventListener('invalid', () => select(false));
    edit.addEventListener('click', () => select(false));
    preview.addEventListener('click', () => select(true));
    [edit, preview].forEach(tab =>
      tab.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          const show = tab === edit;
          select(show);
          (show ? preview : edit).focus();
        }
      })
    );
  }
}
