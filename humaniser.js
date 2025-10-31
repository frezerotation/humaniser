/* humaniser.js
   Local bilingual humaniser with diff-highlighting and "AI" aggressive rewrite mode.
   - Call humaniser.humanise(text, options) -> returns rewritten plain text
   - Call humaniser.diffHighlight(orig, newText, opts) -> returns HTML showing colored edits
   - Uses seeded RNG for reproducibility
*/

const humaniser = (function(){
  // --- seeded RNG (xorshift32) ---
  let _seed = 1234567;
  function seed(s){
    _seed = s >>> 0;
    if(_seed === 0) _seed = 1;
  }
  function rnd(){ // 0..1
    _seed ^= _seed << 13;
    _seed ^= _seed >>> 17;
    _seed ^= _seed << 5;
    return ((_seed >>> 0) % 1000000) / 1000000;
  }
  function choose(arr, prob=0.6){
    if(!Array.isArray(arr) || arr.length===0) return '';
    if(rnd() < prob) return arr[0];
    return arr[Math.floor(rnd()*arr.length)];
  }

  // --- bilingual dictionaries (expand as needed) ---
  const dict = {
    en: {
      synonyms: {
        'utilize': ['use','make use of'],
        'approximately': ['about','around'],
        'implement': ['put in place','roll out','set up'],
        'evaluate': ['review','check','assess','look over'],
        'recommended': ['suggested','advised'],
        'therefore': ['so','thus'],
        'contact': ['reach out','get in touch'],
        'require': ['need','ask for'],
        'perform': ['do','carry out'],
        'prefer': ['like better','favor'],
        'prototype': ['sample','early version']
      },
      contractions: {
        "do not":"don't","does not":"doesn't","did not":"didn't",
        "cannot":"can't","will not":"won't","is not":"isn't",
        "are not":"aren't","it is":"it's","that is":"that's",
        "i am":"I'm","we are":"we're","you are":"you're","they are":"they're",
        "we will":"we'll","you will":"you'll","i will":"I'll","it will":"it'll"
      }
    },
    nl: {
      synonyms: {
        'implementatie': ['uitvoering','doorvoering','implementatie'],
        'implementeren': ['doorvoeren','uitrollen','invoeren'],
        'evalueren': ['beoordelen','nakijken','controleren'],
        'aanbevolen': ['aangeraden','aanbevolen'],
        'ongeveer': ['rond','circa','ongeveer'],
        'gebruikers': ['gebruikers','gebruikers'],
        'leverancier': ['partij','leverancier','partner'],
        'voorkeur': ['liever hebben','voorkeur hebben'],
        'aanpassingsmogelijkheden': ['instellingsopties','aanpassingen']
      },
      contractions: { /* intentionally sparse for NL */ }
    }
  };

  // helpers
  function escapeRegex(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
  function preserveCase(src, dest){
    if(!src) return dest;
    if(src.toUpperCase()===src) return dest.toUpperCase();
    if(src[0] === src[0].toUpperCase()) return dest[0].toUpperCase() + dest.slice(1);
    return dest;
  }
  function capitalize(s){ if(!s) return s; return s.charAt(0).toUpperCase() + s.slice(1); }

  // language detection (simple)
  function detectLanguage(text){
    const sample = text.slice(0,800).toLowerCase();
    let scoreNL = 0, scoreEN = 0;
    const nlWords = [' de ',' het ',' en ','van ','niet ','zijn ','een ','dat ','heb','door '];
    const enWords = [' the ',' and ',' of ',' to ',' not ',' is ',' are ',' that ',' have '];
    nlWords.forEach(w=>{ if(sample.indexOf(w) !== -1) scoreNL += 1; });
    enWords.forEach(w=>{ if(sample.indexOf(w) !== -1) scoreEN += 1; });
    return scoreNL >= scoreEN ? 'nl' : 'en';
  }

  // apply contractions (language-aware)
  function applyContractions(s, lang, enabled){
    if(!enabled) return s;
    const table = dict[lang] && dict[lang].contractions ? dict[lang].contractions : {};
    for(const [k,v] of Object.entries(table)){
      const re = new RegExp('\\b'+escapeRegex(k)+'\\b','gi');
      s = s.replace(re, m => preserveCase(m, v));
    }
    return s;
  }

  // replace synonyms with rate control
  function replaceSynonyms(s, lang, variability, strength){
    const table = (dict[lang] && dict[lang].synonyms) ? dict[lang].synonyms : {};
    const baseProb = variability === 'high' ? 0.9 : (variability === 'medium' ? 0.6 : 0.3);
    const prob = baseProb * (strength === undefined ? 1.0 : strength);

    // protect URLs and emails
    const placeholders = [];
    s = s.replace(/https?:\/\/\S+|\S+@\S+/gi, function(m){
      placeholders.push(m);
      return `__PH_${placeholders.length-1}__`;
    });

    // prefer longer keys first
    const keys = Object.keys(table).sort((a,b)=>b.length-a.length);
    let replaced = 0;
    const maxPerLine = Math.max(1, Math.floor(2 * prob));
    for(const k of keys){
      if(replaced >= maxPerLine) break;
      const re = new RegExp('\\b'+escapeRegex(k)+'\\b','gi');
      s = s.replace(re, function(m){
        if(rnd() > prob) return m;
        replaced++;
        const opts = table[k];
        const pick = Array.isArray(opts) ? choose(opts, 0.6) : opts;
        return preserveCase(m, pick);
      });
    }

    // restore placeholders
    s = s.replace(/__PH_(\d+)__/g, (m,n)=>placeholders[n] || m);
    return s;
  }

  // passive->active english (naive heuristics)
  function passiveToActive_en(sent){
    const trimmed = sent.trim();
    const trailMatch = trimmed.match(/([.!?]+)$/);
    const trail = trailMatch ? trailMatch[1] : '';
    const core = trimmed.replace(/[.!?]+$/,'').trim();

    let re = /^(.+?)\s+(?:was|were|is|are|has been|have been|had been)\s+(.+?)\s+by\s+(.+)$/i;
    let m = core.match(re);
    if(m){
      const obj = m[1].trim();
      const verbPhrase = m[2].trim();
      const agent = m[3].trim();
      return capitalize(agent) + ' ' + verbPhrase + ' ' + obj + trail;
    }

    re = /^(.+?)\s+(is|are|was|were)\s+being\s+(.+?)\s+by\s+(.+)$/i;
    m = core.match(re);
    if(m){
      const obj = m[1].trim();
      const aux = m[2].toLowerCase();
      const verb = m[3].trim();
      const agent = m[4].trim();
      let verbBase = verb.split(' ').slice(-1)[0];
      let verbIng = verb;
      if(/\w+ed$/i.test(verbBase)) verbIng = verbBase.replace(/ed$/i,'ing');
      else if(!/ing$/i.test(verb)) verbIng = verb + 'ing';
      return capitalize(agent) + ' ' + aux + ' ' + verbIng + ' ' + obj + trail;
    }
    return sent;
  }
  // passive->active dutch (naive)
  function passiveToActive_nl(sent){
    const trimmed = sent.trim();
    const trailMatch = trimmed.match(/([.!?]+)$/);
    const trail = trailMatch ? trailMatch[1] : '';
    const core = trimmed.replace(/[.!?]+$/,'').trim();

    let re = /^(.+?)\s+(?:werd|werden|is|zijn|wordt|worden|was|waren)\s+(.+?)\s+door\s+(.+)$/i;
    let m = core.match(re);
    if(m){
      const obj = m[1].trim();
      const verbPhrase = m[2].trim();
      const agent = m[3].trim();
      return capitalize(agent) + ' ' + verbPhrase + ' ' + obj + trail;
    }
    return sent;
  }

  // aggressive "AI-like" rewrite heuristics: clause reorder, paraphrase, merge/split
  function aiRewriteSentence(sent, lang, strength){
    // do a few stronger operations depending on strength and rnd()
    let s = sent.trim();

    // 1) sometimes convert passive->active
    if(rnd() < 0.75 * strength){
      s = lang === 'nl' ? passiveToActive_nl(s) : passiveToActive_en(s);
    }

    // 2) paraphrase synonyms aggressively
    s = replaceSynonyms(s, lang, 'high', strength);

    // 3) clause reorder: if contains comma or 'and'/'en', move a tail clause to front sometimes
    if(rnd() < 0.4 * strength){
      const commaParts = s.split(',');
      if(commaParts.length >= 2 && commaParts[0].length < 80){
        // move second clause to front occasionally
        if(rnd() < 0.5){
          const first = commaParts.shift().trim();
          const second = commaParts.join(',').trim();
          s = capitalize(second) + ', ' + first;
        }
      } else {
        // try splitting on ' and ' / ' en '
        if(lang === 'en'){
          const andParts = s.split(/\s+and\s+/i);
          if(andParts.length>1 && rnd() < 0.5){
            s = capitalize(andParts.slice(1).join(' and ').trim()) + '. ' + capitalize(andParts[0].trim()) + '.';
          }
        } else {
          const andParts = s.split(/\s+en\s+/i);
          if(andParts.length>1 && rnd() < 0.5){
            s = capitalize(andParts.slice(1).join(' en ').trim()) + '. ' + capitalize(andParts[0].trim()) + '.';
          }
        }
      }
    }

    // 4) shorten or expand depending on strength
    if(s.length > 120 && rnd() < 0.9 * strength) s = shortenSentence(s, lang);
    else if(s.length < 80 && rnd() < 0.2 * strength){
      // expand slightly: add clarifying phrase
      if(lang === 'en') s = s.replace(/([.!?])?$/, ', which helps clarify the matter.');
      else s = s.replace(/([.!?])?$/, ', wat dit verduidelijkt.');
    }

    // 5) tone tweaks
    if(strength > 0.6 && rnd() < 0.3){
      if(lang === 'en' && rnd() < 0.5) s = s.replace(/\b(it is|this is)\b/ig, 'it’s');
      if(lang === 'nl' && rnd() < 0.2) s = s.replace(/\b(het is|dit is)\b/ig, 'het is');
    }

    // ensure punctuation
    s = s.trim();
    if(!/[.!?]$/.test(s)) s += '.';
    return s;
  }

  // default shorten function used earlier
  function shortenSentence(sent, lang){
    const s = sent.trim();
    if(s.length < 120) return sent;
    if(s.indexOf(';')>-1){
      const parts = s.split(';').map(p=>p.trim()).filter(Boolean);
      return parts.slice(0,2).map(p=>capitalize(p)+'.').join(' ');
    }
    if(s.indexOf(',')>-1){
      const parts = s.split(',').map(p=>p.trim()).filter(Boolean);
      return parts.slice(0,2).map(p=>capitalize(p)+'.').join(' ');
    }
    if(lang === 'en'){
      const parts = s.split(/\s+(and|but|so)\s+/i);
      if(parts.length>1){ const first = parts[0].trim(); const rest = parts.slice(2).join(' ').trim(); return capitalize(first)+'. ' + capitalize(rest)+'.'; }
    } else {
      const parts = s.split(/\s+(en|maar|dus|omdat)\s+/i);
      if(parts.length>1){ const first = parts[0].trim(); const rest = parts.slice(2).join(' ').trim(); return capitalize(first)+'. ' + capitalize(rest)+'.'; }
    }
    return s.slice(0,100).trim() + '...';
  }

  // naive sentence splitter retaining punctuation
  function splitSentences(text){
    const matches = text.match(/[^.!?]+[.!?]?/g);
    if(!matches) return [text];
    return matches.map(m=>m.trim()).filter(Boolean);
  }

  // MAIN humanise function: per-line processing preserving layout
  function humanise(text, options = {}){
    if(!text) return '';
    const opts = Object.assign({
      tone: 'formal',
      variability: 'medium',
      contractions: true,
      shorten: true,
      strength: 1.0,
      lang: 'auto',
      aiMode: false,
      rewrite: true
    }, options);

    const effectiveLang = opts.lang === 'auto' ? detectLanguage(text) : (['en','nl'].includes(opts.lang) ? opts.lang : 'en');

    const lines = text.split(/\r\n|\n/);
    const outLines = lines.map(line=>{
      const leading = (line.match(/^\s*/)||[''])[0];
      const trailing = (line.match(/\s*$/)||[''])[0];
      const core = line.trim();
      if(core === '') return leading + '' + trailing;

      // split into sentences and transform each
      let sents = splitSentences(core);
      sents = sents.map(sent=>{
        let s = sent.trim();
        s = capitalize(s);

        // choose rewrite path (AI aggressive or gentle)
        if(opts.aiMode && opts.rewrite){
          // stronger rewriting with ai heuristics
          s = aiRewriteSentence(s, effectiveLang, opts.strength);
        } else {
          // lighter path: passive->active sometimes, synonyms, contractions
          const passiveProb = (opts.variability === 'high' ? 0.6 : (opts.variability === 'medium' ? 0.35 : 0.15)) * (opts.strength || 1);
          if(rnd() < passiveProb){
            s = effectiveLang === 'nl' ? passiveToActive_nl(s) : passiveToActive_en(s);
          }
          s = replaceSynonyms(s, effectiveLang, opts.variability, opts.strength);
          if(opts.contractions && effectiveLang === 'en') s = applyContractions(s, effectiveLang, true);
          if(opts.shorten && s.length > 120 && rnd() < 0.9 * (opts.strength || 1)) s = shortenSentence(s, effectiveLang);
          if(opts.tone === 'friendly' && rnd() < 0.12 * (opts.strength || 1)){
            if(effectiveLang === 'en') s = s.replace(/([.!?])?$/, ', just saying.');
            else s = s.replace(/([.!?])?$/, ', ter info.');
          }
        }

        if(!/[.!?]$/.test(s)) s += '.';
        return s;
      });

      const newCore = sents.join(' ');
      return leading + newCore + trailing;
    });

    return outLines.join('\n');
  }

  // ===== Diff highlighting logic =====
  // We'll do a token-level LCS diff for words (ignoring whitespace tokens), then produce HTML:
  // deletions: red strikethrough (.diff-del)
  // insertions: green underline (.diff-ins)
  // replacements: show deletion then insertion side-by-side (.diff-repl)
  // We preserve per-line structure: compute diff per corresponding input line and output line.
  function tokenizeForDiff(s){
    // produce array of tokens (words and punctuation). We'll keep tokens but ignore pure whitespace
    // regex captures words (including apostrophes) and punctuation as separate tokens
    const tokens = s.match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9]+(?:'[A-Za-z0-9]+)?|[^\sA-Za-z0-9]+/g) || [];
    return tokens;
  }

  // LCS DP for token arrays
  function lcs(a,b){
    const n=a.length, m=b.length;
    const dp = Array(n+1).fill(null).map(()=>Array(m+1).fill(0));
    for(let i=n-1;i>=0;i--){
      for(let j=m-1;j>=0;j--){
        if(a[i].toLowerCase() === b[j].toLowerCase()) dp[i][j] = 1 + dp[i+1][j+1];
        else dp[i][j] = Math.max(dp[i+1][j], dp[i][j+1]);
      }
    }
    // reconstruct matching pairs
    const res = [];
    let i=0,j=0;
    while(i<n && j<m){
      if(a[i].toLowerCase() === b[j].toLowerCase()){
        res.push({type:'match', a:i, b:j, token:a[i]});
        i++; j++;
      } else if(dp[i+1][j] >= dp[i][j+1]) { res.push({type:'del', a:i, token:a[i]}); i++; }
      else { res.push({type:'ins', b:j, token:b[j]}); j++; }
    }
    while(i<n){ res.push({type:'del', a:i, token:a[i]}); i++; }
    while(j<m){ res.push({type:'ins', b:j, token:b[j]}); j++; }
    return res;
  }

  // create HTML for a single line diff
  function diffLineHtml(origLine, newLine){
    const a = tokenizeForDiff(origLine);
    const b = tokenizeForDiff(newLine);
    if(a.length === 0 && b.length === 0) return '';
    const ops = lcs(a,b);
    // build html
    const parts = [];
    for(let k=0;k<ops.length;k++){
      const op = ops[k];
      if(op.type === 'match'){
        parts.push(escapeHtml(op.token));
      } else if(op.type === 'del'){
        // show deletion (red strikethrough)
        parts.push(`<span class="diff-del">${escapeHtml(op.token)}</span>`);
      } else if(op.type === 'ins'){
        // show insertion (green)
        parts.push(`<span class="diff-ins">${escapeHtml(op.token)}</span>`);
      }
    }
    // join tokens with single space but attempt to keep punctuation spacing natural:
    // If a token is punctuation, don't prepend a space.
    let out = '';
    for(let i=0;i<parts.length;i++){
      const rawToken = (ops[i] && ops[i].token) ? ops[i].token : '';
      const isPunct = /^[^\w]+$/.test(rawToken);
      if(i>0 && !isPunct) out += ' ';
      out += parts[i];
    }
    return out;
  }

  // escape HTML
  function escapeHtml(s){
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // top-level diff highlight for full text: we compare per-line where possible
  function diffHighlight(origText, newText, opts = {}){
    const origLines = origText.split(/\r\n|\n/);
    const newLines = newText.split(/\r\n|\n/);
    const maxLines = Math.max(origLines.length, newLines.length);
    const linesHtml = [];
    for(let i=0;i<maxLines;i++){
      const a = origLines[i] || '';
      const b = newLines[i] || '';
      // if exact equality -> output escaped text (no highlights)
      if(a.trim() === b.trim()){
        linesHtml.push(escapeHtml(b));
      } else {
        // do a token-level diff for the line pair
        const html = diffLineHtml(a, b);
        linesHtml.push(html);
      }
    }
    // join with newline -> use <div> with <br> for rendering
    return linesHtml.map(l=>l || '').join('\n');
  }

  // Expose API
  return {
    humanise,
    seed,
    diffHighlight
  };
})();
