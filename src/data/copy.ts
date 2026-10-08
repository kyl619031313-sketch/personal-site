import data from './zh-CN.json';

// Empty CMS lists still need item types so owners can add entries later.
interface Service { title: string; description: string; items: string[]; }
interface Case { title: string; tag: string; description: string; metric: string; metricLabel: string; detail: string; }
interface Question { question: string; answer: string; }
interface Step { title: string; text: string; }

export default {
  ...data,
  services: data.services as Service[],
  cases: data.cases as Case[],
  faq: { ...data.faq, faqs: data.faq.faqs as Question[] },
  process: { ...data.process, steps: data.process.steps as Step[] },
  pages: {
    ...data.pages,
    about: { ...data.pages.about, values: data.pages.about.values as string[] },
    contact: { ...data.pages.contact, prepare: data.pages.contact.prepare as string[] },
  },
};
