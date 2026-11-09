// The content files, as the pages get them at build time (no answer keys).

interface PublicOption {
  id: string;
  text: string;
  text_ar?: string;
}

interface PublicQuestion {
  id: string;
  text: string;
  text_ar?: string;
  options: PublicOption[];
}

interface PublicTopics {
  question: string;
  question_ar: string;
  min: number;
  max: number;
  items: { id: string; label: string; label_ar: string }[];
}

interface PublicQuestionSet {
  audience: 'participants' | 'trainers';
  version: string;
  questions: PublicQuestion[];
  topics?: PublicTopics;
}

interface PublicRubric {
  scale: { min: number; max: number };
  lines: { id: string; name: string; four: string }[];
  parts: string[];
}

declare module 'virtual:participant-questions' {
  const data: PublicQuestionSet;
  export default data;
}

declare module 'virtual:trainer-questions' {
  const data: PublicQuestionSet;
  export default data;
}

declare module 'virtual:rubric' {
  const data: PublicRubric;
  export default data;
}
