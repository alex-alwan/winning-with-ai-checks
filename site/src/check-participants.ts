import './styles.css';
import content from 'virtual:participant-questions';
import { runCheck } from './check';
import { numberWord, capitalise } from './util';

const count = numberWord(content.questions.length);

// Copy from the approved reference page, word for word.
runCheck({
  audience: 'participants',
  content,
  askOrg: false,
  copy: {
    chooserEyebrow: 'Course check',
    chooser: { before: 'At the start of the course', after: 'At the end of the course' },
    stages: {
      before: {
        label: 'Before the course',
        intro: `${capitalise(count)} short questions about starting a business with AI. It takes about 10 minutes. You will answer the same questions again at the end of the course.`,
      },
      after: {
        label: 'After the course',
        intro: `The same ${count} questions you answered at the start. It takes about 10 minutes. Answer with what you know now.`,
      },
    },
    noteHtml:
      '<p><b>There is no pass or fail.</b> Choose the answer you believe is best, even if you are not sure. Please do not look anything up or ask others.</p>' +
      '<p>The questions follow <b>Rania</b>, a made-up founder starting a weekly meal service for busy parents in Amman.</p>' +
      '<p>Your answers are seen only by the course team, to measure what the course teaches.</p>',
    doneBefore: 'You will answer the same questions at the end of the course. Enjoy the two days.',
    doneAfter: 'Keep practising for the next 30 days with your Launch Kit.',
    startLabel: 'Start of course',
  },
});
