import './styles.css';
import content from 'virtual:trainer-questions';
import { runCheck } from './check';
import { numberWord, capitalise } from './util';

const count = numberWord(content.questions.length);

runCheck({
  audience: 'trainers',
  content,
  askOrg: true,
  showScore: false, // Alex, 11 Nov: the numbers on the end screen were unclear, so trainers see none
  copy: {
    chooserEyebrow: 'Trainer check',
    chooser: { before: 'At the start of the training', after: 'At the end of the training' },
    stages: {
      before: {
        label: 'Before the training',
        intro: `${capitalise(count)} questions about the ideas in this training, each with Arabic under it. About 10 minutes. You will answer the same questions at the end of the training.`,
      },
      after: {
        label: 'After the training',
        intro: `${capitalise(count)} questions about the ideas in this training, each with Arabic under it, then one short question about the topics that helped you most. About 10 minutes.`,
      },
    },
    noteHtml:
      '<p><b>There is no pass or fail.</b> Choose the answer you believe is best, even if you are not sure. Please do not look anything up or ask others.</p>' +
      '<p>Your answers are seen only by the course team, to measure what the training teaches.</p>',
    doneBefore: 'You will answer the same questions at the end of the training. Enjoy the two days.',
    doneAfter: 'Thank you for taking part in the training.',
    startLabel: 'Start of training',
    orgLabel: 'Your organisation',
    emailError: 'Please write a valid email.', // Alex, 11 Nov: no mention of a start-of-training check
    orgHint: 'The incubator or accelerator you work with.',
  },
});
