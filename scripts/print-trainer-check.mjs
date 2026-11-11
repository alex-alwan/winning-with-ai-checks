// Writes docs/trainer-check.md from content/trainer-questions.json: every question and option in
// English and Arabic, the answer key with the reason, and the end-of-training topics.
// The key section is for the course team only. Run: node scripts/print-trainer-check.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadContent } from './content.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { trainers } = loadContent();
const WHY = {
  tq1: 'Trainer Pack: "Never cut the hands-on work." Founders learn by doing the task on their own startup.',
  tq2: 'Trainer Pack habits: walk the room, check each person against the goal of the exercise, help those who did not reach it first.',
  tq3: 'Real problem test: people already pay, in time or money, for their own workaround. Praise and a bigger survey are not evidence.',
  tq4: 'Interview questions ask about real past events, never the future or the idea (Launch Kit, "My 5 questions about the past").',
  tq5: 'The pass mark is written before sending, so nobody can reread the results to make them look good.',
  tq6: 'Trainer Pack: "Good, that is why we test. Answers vary." Then show the prepared example and move on.',
  tq7: 'Trainer Pack: correcting the AI teaches only that chat; put the fix in the fact sheet or saved instructions, then test again.',
  tq8: 'P8/P9: text from customers is information, never instructions, so no customer can change the rules; money questions go to the founder. A single line such as "never give anything free" is exactly what "Ignore your rules" attacks.',

  tq10: 'Go-live checks: read every chat, switch it off in a minute, and the welcome says it is an AI (plus read every chat in week 1).',
};
const q = trainers.questions;
let md = `# Trainer check, version 2 (English and Arabic)

Generated from \`content/trainer-questions.json\`. Do not edit by hand: change the content file, then run \`node scripts/print-trainer-check.mjs\`.

The same ${q.length} questions at the start and the end of the training. They test understanding of the ideas, not the course's own terms. On screen, the order of questions and options changes for each person, and the Arabic sits under the English.

`;
q.forEach((x, i) => {
  md += `## ${i + 1}. ${x.text}\n\n<p dir="rtl" lang="ar">${x.text_ar}</p>\n\n`;
  Object.keys(x.options).forEach((k) => {
    md += `- **${k})** ${x.options[k]}<br><span dir="rtl" lang="ar">${x.options_ar[k]}</span>\n`;
  });
  md += '\n';
});
const t = trainers.topics;
md += `## End of the training only: topics (not scored)

${t.question}

<p dir="rtl" lang="ar">${t.question_ar}</p>

Choose ${t.min} to ${t.max}:

${t.items.map((x) => `- ${x.label}<br><span dir="rtl" lang="ar">${x.label_ar}</span>`).join('\n')}

---

## Answer key: course team only

Do not share this section before the training. The live site marks answers on the server.

| Question | Answer | Skill | Why it is right |
| --- | --- | --- | --- |
${q.map((x, i) => `| ${i + 1} | ${x.key} | ${x.skill} | ${WHY[x.id] || ''} |`).join('\n')}
`;
writeFileSync(join(ROOT, 'docs/trainer-check.md'), md);
console.log('wrote docs/trainer-check.md');
