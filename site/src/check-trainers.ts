import './styles.css';
import content from 'virtual:trainer-questions';
import { runCheck } from './check';
import { numberWord, capitalise } from './util';

const count = numberWord(content.questions.length);

runCheck({
  audience: 'trainers',
  content,
  askOrg: true,
  copy: {
    chooserEyebrow: 'Trainer check',
    chooser: { before: 'At the start of the training', after: 'At the end of the training' },
    stages: {
      before: {
        label: 'Before the training',
        intro: `${capitalise(count)} short questions about running this course. About 8 minutes. You will answer the same questions at the end of the training.`,
      },
      after: {
        label: 'After the training',
        intro: `The same ${count} questions you answered at the start. About 8 minutes. Answer with what you know now.`,
      },
    },
    noteHtml:
      '<p><b>There is no pass or fail.</b> Choose the answer you believe is best, even if you are not sure. Please do not look anything up or ask others.</p>' +
      '<p>Your answers are seen only by the course team, to measure what the training teaches.</p>',
    doneBefore: 'You will answer the same questions at the end of the training. Enjoy the two days.',
    doneAfter: '',
    startLabel: 'Start of training',
    orgLabel: 'Your organisation',
    orgHint: 'The incubator or accelerator you work with.',
  },
});
