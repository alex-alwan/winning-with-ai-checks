// Projector page (/show): a big QR code for the matching check link. The code is made here, in the browser.
import './styles.css';
import './show.css';
import { encode } from 'uqr';
import { $, setText, param, cohortFromLink } from './util';

const audience = param('audience').toLowerCase() === 'trainers' ? 'trainers' : 'participants';
const stageRaw = param('stage').toLowerCase();
const stage = stageRaw === 'before' || stageRaw === 'after' ? stageRaw : '';
const cohort = cohortFromLink();

const LABELS: Record<string, Record<string, string>> = {
  participants: { before: 'Before the course', after: 'After the course', '': 'Course check' },
  trainers: { before: 'Before the training', after: 'After the training', '': 'Trainer check' },
};

const target = new URL(audience === 'trainers' ? '/trainer' : '/check', window.location.origin);
if (stage) target.searchParams.set('stage', stage);
if (cohort) target.searchParams.set('cohort', cohort);
const link = target.toString();

function qrSvg(text: string): string {
  const { data, size } = encode(text, { ecc: 'M', border: 2 });
  let d = '';
  data.forEach((row, y) => {
    let x = 0;
    while (x < size) {
      if (!row[x]) { x++; continue; }
      let w = 1;
      while (x + w < size && row[x + w]) w++;
      d += `M${x} ${y}h${w}v1h-${w}z`;
      x += w;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code for ${link.replace(/[<>&"]/g, '')}"><rect width="${size}" height="${size}" fill="#ffffff"/><path fill="#0a2240" d="${d}"/></svg>`;
}

setText($('showStage'), LABELS[audience][stage]);
$('qr').innerHTML = qrSvg(link);
setText($('showLink'), link.replace(/^https?:\/\//, ''));
document.title = 'Winning with AI · Scan to start';
