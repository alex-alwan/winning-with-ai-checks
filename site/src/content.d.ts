// The content files, as the pages get them at build time (no answer keys).

interface PublicOption {
  id: string;
  text: string;
}

interface PublicQuestion {
  id: string;
  text: string;
  options: PublicOption[];
}

interface PublicQuestionSet {
  audience: 'participants' | 'trainers';
  version: string;
  questions: PublicQuestion[];
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
