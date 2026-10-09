export const sections = {
  home: {
    label: '首页',
    schema: {
      home: {
        eyebrow: '引导文字',
        title: '主标题',
        description: '介绍',
        primary: '联系按钮',
        secondary: '服务按钮',
        panelTitle: '面板标题',
        panelLabel: '面板标签',
        platforms: '平台',
        whoLabel: '介绍标签',
        whoTitle: '介绍标题',
        whoText: '介绍正文',
        whoLink: '介绍链接文字',
        servicesLabel: '服务标签',
        servicesTitle: '服务标题',
        casesLabel: '案例标签',
        casesTitle: '案例标题',
        casesNote: '案例说明',
      },
      cta: {
        label: '联系区块标签',
        title: '联系区块标题',
        description: '联系区块介绍',
        button: '联系按钮文字',
      },
    },
  },
  services: {
    label: '服务',
    schema: {
      pages: {
        services: {
          title: 'SEO 标题',
          description: 'SEO 描述',
          eyebrow: '标签',
          heading: '标题',
          intro: '介绍',
        },
      },
      services: [
        { title: '服务名称', description: '服务介绍', items: ['服务项目'] },
      ],
      process: {
        title: '流程标题',
        steps: [{ title: '步骤标题', text: '步骤说明' }],
      },
    },
  },
  cases: {
    label: '案例',
    schema: {
      cases: [
        {
          title: '案例标题',
          tag: '分组标签',
          description: '介绍',
          metric: '指标',
          metricLabel: '指标说明',
          detail: '详情',
        },
      ],
    },
  },
  faq: {
    label: '常见问题',
    schema: {
      faq: {
        title: '标题',
        subTitle: '副标题',
        faqs: [{ question: '问题', answer: '回答' }],
      },
    },
  },
  about: {
    label: '关于',
    schema: {
      pages: {
        about: {
          title: 'SEO 标题',
          description: 'SEO 描述',
          eyebrow: '标签',
          heading: '标题',
          intro: '介绍',
          body: '正文',
          body2: '正文补充',
          valuesTitle: '理念标题',
          values: ['理念'],
        },
      },
    },
  },
  contact: {
    label: '联系',
    schema: {
      pages: {
        contact: {
          title: 'SEO 标题',
          description: 'SEO 描述',
          eyebrow: '标签',
          heading: '标题',
          intro: '介绍',
          emailLabel: '邮件标签',
          email: '电子邮件',
          telegramLabel: 'Telegram 标签',
          telegram: 'Telegram',
          note: '说明',
          prepareTitle: '准备事项标题',
          prepare: ['准备事项'],
        },
      },
    },
  },
  nav: {
    label: '导航',
    schema: { nav: [{ label: '名称', href: '链接路径' }] },
  },
  settings: {
    label: '设置',
    schema: {
      site: {
        name: '站点名称',
        title: 'SEO 标题',
        description: 'SEO 描述',
        footer: '页脚介绍',
        copyright: '版权',
        note: '页脚备注',
        skip: '跳转正文文字',
      },
    },
  },
};
export const escape = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]
  );
const blank = schema =>
  typeof schema === 'string'
    ? ''
    : Array.isArray(schema)
      ? []
      : Object.fromEntries(
          Object.entries(schema).map(([k, s]) => [k, blank(s)])
        );
const longField = path =>
  /(?:description|intro|body2?|whoText|answer|detail|text|note|casesNote|footer)$/.test(
    path
  );
const listLabels = {
  services: '服务列表',
  items: '服务项目',
  cases: '案例列表',
  faqs: '问题列表',
  nav: '导航链接',
  steps: '流程步骤',
  values: '理念列表',
  prepare: '准备事项',
};
export function fields(schema, data, path = '') {
  if (typeof schema === 'string') {
    const long = longField(path);
    const hint = /href$/.test(path)
      ? '填写站内路径，例如 /blog/'
      : /email$/.test(path)
        ? '填写联系邮箱，例如 hello@example.com'
        : `填写${schema}${long ? '，简洁说明相关内容' : ''}`;
    return `<div class="field ${long ? 'long' : ''}"><label for="${escape(path)}">${escape(schema)}</label>${long ? `<textarea id="${escape(path)}" rows="3" name="field:${escape(path)}" placeholder="${escape(hint)}">${escape(data)}</textarea>` : `<input id="${escape(path)}" name="field:${escape(path)}" placeholder="${escape(hint)}" value="${escape(data)}">`}</div>`;
  }
  if (Array.isArray(schema)) {
    const label = listLabels[path.split('.').at(-1)] || '列表';
    return `<fieldset class="list"><legend>${label}</legend><p class="helper">添加、调整顺序或删除后，点击保存并发布。</p>${(
      data ?? []
    )
      .map(
        (row, i) =>
          `<div class="row"><div class="row-head"><span>${label} · ${i + 1}</span><div class="row-actions">${[
            ['up', '上移', '↑'],
            ['down', '下移', '↓'],
            ['remove', '删除', '×'],
          ]
            .map(
              ([a, l, icon]) =>
                `<button class="icon-button" name="operation" value="${a}:${escape(path)}:${i}" aria-label="${l}第 ${i + 1} 项" title="${l}" ${(a === 'up' && i === 0) || (a === 'down' && i === data.length - 1) ? 'disabled' : ''} formnovalidate>${icon}</button>`
            )
            .join(
              ''
            )}</div></div><div class="fields-grid">${fields(schema[0], row, `${path}.${i}`)}</div></div>`
      )
      .join(
        ''
      )}<button class="secondary" name="operation" value="add:${escape(path)}" formnovalidate>＋ 添加</button></fieldset>`;
  }
  return Object.entries(schema)
    .map(([k, s]) => fields(s, data?.[k], path ? `${path}.${k}` : k))
    .join('');
}
// Group only existing schema keys; parsing and the persisted shape are unchanged.
const groups = {
  home: [
    ['首屏', 'home', 'eyebrow title description primary secondary'],
    ['信息面板', 'home', 'panelTitle panelLabel platforms'],
    ['个人介绍', 'home', 'whoLabel whoTitle whoText whoLink'],
    ['服务区', 'home', 'servicesLabel servicesTitle'],
    ['案例区', 'home', 'casesLabel casesTitle casesNote'],
    ['联系区', 'cta'],
  ],
  settings: [
    ['站点', 'site', 'name skip'],
    ['SEO', 'site', 'title description'],
    ['页脚', 'site', 'footer copyright note'],
  ],
  services: [
    ['SEO', 'pages.services', 'title description'],
    ['页面介绍', 'pages.services', 'eyebrow heading intro'],
    ['服务区', 'services'],
    ['合作流程', 'process'],
  ],
  cases: [['案例区', 'cases']],
  faq: [
    ['常见问题区', 'faq', 'title subTitle'],
    ['问题与回答', 'faq', 'faqs'],
  ],
  about: [
    ['SEO', 'pages.about', 'title description'],
    ['页面介绍', 'pages.about', 'eyebrow heading intro'],
    ['个人介绍', 'pages.about', 'body body2'],
    ['理念', 'pages.about', 'valuesTitle values'],
  ],
  contact: [
    ['SEO', 'pages.contact', 'title description'],
    ['页面介绍', 'pages.contact', 'eyebrow heading intro'],
    [
      '联系方式',
      'pages.contact',
      'emailLabel email telegramLabel telegram note',
    ],
    ['准备事项', 'pages.contact', 'prepareTitle prepare'],
  ],
  nav: [['主导航', 'nav']],
};
export function groupedFields(key, data) {
  return groups[key]
    .map(([title, path, keys]) => {
      const get = object =>
        path.split('.').reduce((value, k) => value?.[k], object);
      const schema = get(sections[key].schema);
      const selected = keys
        ? Object.fromEntries(keys.split(' ').map(k => [k, schema[k]]))
        : schema;
      return `<section class="card"><h2>${title}</h2><p class="helper">${title === 'SEO' ? '设置搜索结果中的标题与描述。' : `编辑${title}内容；空字段将保持为空。`}</p><div class="${Array.isArray(selected) ? '' : 'fields-grid'}">${fields(selected, get(data), path)}</div></section>`;
    })
    .join('');
}
export function update(schema, data, form, path = '') {
  if (typeof schema === 'string') {
    const key = `field:${path}`;
    if (!form.has(key)) throw Error('表单字段缺失，请刷新后重试。');
    const value = form.get(key);
    if (
      path.startsWith('nav.') &&
      path.endsWith('.href') &&
      !/^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(value)
    )
      throw Error('导航链接必须是站内路径，例如 /blog/。');
    return value;
  }
  if (Array.isArray(schema)) {
    const rows = (data ?? []).map((r, i) =>
      update(schema[0], r, form, `${path}.${i}`)
    );
    const [action, target, index] = (form.get('operation') ?? '').split(':');
    if (target === path) {
      const i = Number(index);
      if (action === 'add') rows.push(blank(schema[0]));
      else if (Number.isInteger(i) && i >= 0 && i < rows.length) {
        if (action === 'remove') rows.splice(i, 1);
        else if (action === 'up' && i > 0)
          [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]];
        else if (action === 'down' && i + 1 < rows.length)
          [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]];
      }
    }
    return rows;
  }
  const result = { ...data };
  for (const [k, s] of Object.entries(schema))
    result[k] = update(s, data?.[k], form, path ? `${path}.${k}` : k);
  return result;
}
export function validFields(schema, data, path = '', set = new Set()) {
  if (typeof schema === 'string') set.add(`field:${path}`);
  else if (Array.isArray(schema)) {
    set.add(`list:${path}`);
    (data ?? []).forEach((r, i) =>
      validFields(schema[0], r, `${path}.${i}`, set)
    );
  } else
    for (const [k, s] of Object.entries(schema))
      validFields(s, data?.[k], path ? `${path}.${k}` : k, set);
  return set;
}
