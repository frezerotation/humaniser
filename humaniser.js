/* humaniser.js
   Bilingual (EN / NL) local humaniser.
   - Preserves line breaks & blank lines (visual shape).
   - No em-dashes or "big lines".
   - Language-aware rules: synonyms, contractions, passive->active (EN + NL).
   - Controlled variability + strength.
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

  // --- bilingual dictionaries ---
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
        'prefer': ['like better','favor']
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
        'implementatie.': ['uitvoering.'],
        'implementeren': ['doorvoeren','uitrollen','invoeren'],
        'evalueren': ['beoordelen','nakijken','controleren'],
        'aanbevolen': ['aangeraden','aanbevolen'],
        'ongeveer': ['rond','circa','ongeveer'],
        'gebruikers': ['gebruikers','gebruikers'],
        'leverancier': ['partij','leverancier','partner'],
        'voorkeur': ['liever hebben','voorkeur hebben'],
        'aanpassingsmogelijkheden': ['instellingsopties','aanpassingen']
      },
      // Dutch does not use the same contraction patterns; we prefer colloquial swaps instead.
      contractions: {
        "het is": "het is", // keep; avoid fake contractions
        "dat is": "dat is"
      }
    }
  };

  // small helpers
  function escapeRegex(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
  function preserveCase(src, dest){
    if(!src) return dest;
    if(src.toUpperCase()===src) return dest.toUpperCase();
    if(src[0] === src[0].toUpperCase()) return dest[0].toUpperCase() + dest.slice(1);
    return dest;
  }

  // language detection (very simple): count common Dutch vs English tokens
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
      if(k === v) continue; // skip identity
      const re = new RegExp('\\b'+escapeRegex(k)+'\\b','gi');
      s = s.replace(re, m => preserveCase(m, v));
    }
    return s;
  }

  // replace synonyms (word & short phrase level). Controlled by variability+strength.
  function replaceSynonyms(s, lang, variability, strength){
    const table = (dict[lang] && dict[lang].synonyms) ? dict[lang].synonyms : {};
    const baseProb = variability === 'high' ? 0.9 : (variability === 'medium' ? 0.6 : 0.3);
    const prob = baseProb * (strength === undefined ? 1.0 : strength);

    // protect URLs and emails
    const placeholders = [];
    s = s.replace(/https?:\/\/\S+|\S+@\S+/gi, function(m){
      placeholders.push(m);
      return `__PLACEHOLDER_${placeholders.length-1}__`;
    });

    // replace multi-word keys first (order by length)
    const keys = Object.keys(table).sort((a,b)=>b.length-a.length);
    let replacedCount = 0;
    const maxReplacePerLine = Math.max(1, Math.floor(2 * prob));

    for(const k of keys){
      if(replacedCount >= maxReplacePerLine) break;
      const re = new RegExp('\\b'+escapeRegex(k)+'\\b','gi');
      s = s.replace(re, function(m){
        if(rnd() > prob) return m;
        replacedCount++;
        const opts = table[k];
        const pick = Array.isArray(opts) ? choose(opts, 0.6) : opts;
        return preserveCase(m, pick);
      });
    }

    // restore placeholders
    s = s.replace(/__PLACEHOLDER_(\d+)__/g, (m,n)=>placeholders[n] || m);
    return s;
  }

  // improved passive->active for English
  function passiveToActive_en(sent){
    const trimmed = sent.trim();
    const trailMatch = trimmed.match(/([.!?]+)$/);
    const trail = trailMatch ? trailMatch[1] : '';
    const core = trimmed.replace(/[.!?]+$/,'').trim();

    // pattern: "The results were evaluated by the team"
    let re = /^(.+?)\s+(?:was|were|is|are|has been|have been|had been)\s+(.+?)\s+by\s+(.+)$/i;
    let m = core.match(re);
    if(m){
      const obj = m[1].trim();
      const verbPhrase = m[2].trim();
      const agent = m[3].trim();
      // make simple: "Agent [verbPhrase] obj"
      return capitalize(agent) + ' ' + verbPhrase + ' ' + obj + trail;
    }

    // pattern: "is being reviewed by X" -> "X is reviewing ..."
    re = /^(.+?)\s+(is|are|was|were)\s+being\s+(.+?)\s+by\s+(.+)$/i;
    m = core.match(re);
    if(m){
      const obj = m[1].trim();
      const aux = m[2].toLowerCase();
      const verb = m[3].trim();
      const agent = m[4].trim();
      // try to make progressive: agent [aux] [verb + ing] obj
      let verbBase = verb.split(' ').slice(-1)[0];
      let verbIng = verb;
      if(/\w+ed$/i.test(verbBase)) verbIng = verbBase.replace(/ed$/i,'ing');
      else if(!/ing$/i.test(verb)) verbIng = verb + 'ing';
      return capitalize(agent) + ' ' + aux + ' ' + verbIng + ' ' + obj + trail;
    }

    return sent;
  }

  // passive->active for Dutch (simple)
  function passiveToActive_nl(sent){
    const trimmed = sent.trim();
    const trailMatch = trimmed.match(/([.!?]+)$/);
    const trail = trailMatch ? trailMatch[1] : '';
    const core = trimmed.replace(/[.!?]+$/,'').trim();

    // patterns like "De resultaten werden door het team beoordeeld"
    let re = /^(.+?)\s+(?:werd|werden|is|zijn|wordt|worden|was|waren)\s+(.+?)\s+door\s+(.+)$/i;
    let m = core.match(re);
    if(m){
      const obj = m[1].trim();
      const verbPhrase = m[2].trim();
      const agent = m[3].trim();
      // build: "Het team [verbPhrase] het object"
      return capitalize(agent) + ' ' + verbPhrase + ' ' + obj + trail;
    }

    // handle "wordt beoordeeld door X" -> "X beoordeelt ..."
    re = /^(.+?)\s+wordt\s+(.+?)\s+door\s+(.+)$/i;
    m = core.match(re);
    if(m){
      const obj = m[1].trim();
      const verb = m[2].trim();
      const agent = m[3].trim();
      return capitalize(agent) + ' ' + verb + ' ' + obj + trail;
    }

    return sent;
  }

  function capitalize(s){
    if(!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // sentence splitter: keeps punctuation; operates per line
  function splitSentences(text){
    const matches = text.match(/[^.!?]+[.!?]?/g);
    if(!matches) return [text];
    return matches.map(m=>m.trim()).filter(Boolean);
  }

  // shorten sentences, language-aware
  function shortenSentence(sent, lang){
    const s = sent.trim();
    if(s.length < 120) return sent;
    // try splitting by semicolon/comma
    if(s.indexOf(';')>-1){
      const parts = s.split(';').map(p=>p.trim()).filter(Boolean);
      return parts.slice(0,2).map(p=>capitalize(p)+'.').join(' ');
    }
    if(s.indexOf(',')>-1){
      const parts = s.split(',').map(p=>p.trim()).filter(Boolean);
      return parts.slice(0,2).map(p=>capitalize(p)+'.').join(' ');
    }
    // split on conjunctions based on language
    if(lang === 'en'){
      const parts = s.split(/\s+(and|but|so)\s+/i);
      if(parts.length>1){
        const first = parts[0].trim();
        const rest = parts.slice(2).join(' ').trim();
        return capitalize(first)+'. ' + capitalize(rest)+'.';
      }
    } else {
      const parts = s.split(/\s+(en|maar|dus|omdat)\s+/i);
      if(parts.length>1){
        const first = parts[0].trim();
        const rest = parts.slice(2).join(' ').trim();
        return capitalize(first)+'. ' + capitalize(rest)+'.';
      }
    }
    // fallback hard cut
    return s.slice(0,100).trim() + '...';
  }

  // small cleanup (no em-dashes insertion anywhere)
  function smoothOutput(text){
    return text
      .replace(/\s+([.,!?;:])/g,'$1')
      .replace(/([.,!?;:])([^\s])/g,'$1 $2')
      .replace(/\n{3,}/g,'\n\n')
      .replace(/[ \t]{2,}/g,' ')
      .trim();
  }

  // main humanise: preserves per-line whitespace
  function humanise(text, options = {}){
    if(!text) return '';
    const opts = Object.assign({
      tone: 'casual',
      variability: 'medium',
      contractions: true,
      shorten: true,
      strength: 1.0,
      lang: 'auto'
    }, options);

    // detect language if auto
    let effectiveLang = opts.lang === 'auto' ? detectLanguage(text) : (['en','nl'].includes(opts.lang) ? opts.lang : 'en');

    const lines = text.split(/\r\n|\n/);
    const outLines = lines.map(line=>{
      const leading = (line.match(/^\s*/)||[''])[0];
      const trailing = (line.match(/\s*$/)||[''])[0];
      const core = line.trim();
      if(core === '') return leading + '' + trailing;

      // split into sentences (language-agnostic)
      const sents = splitSentences(core).map(sent => {
        let s = sent.trim();
        // normalize capitalization at start
        s = s.charAt(0).toUpperCase() + s.slice(1);

        // passive->active with probability based on variability & strength
        const passiveProb = (opts.variability === 'high' ? 0.6 : (opts.variability === 'medium' ? 0.35 : 0.15)) * (opts.strength || 1);
        if(rnd() < passiveProb){
          const converted = effectiveLang === 'nl' ? passiveToActive_nl(s) : passiveToActive_en(s);
          if(converted && converted !== s) s = converted;
        }

        // synonyms
        s = replaceSynonyms(s, effectiveLang, opts.variability, opts.strength);

        // contractions (for EN primarily)
        s = applyContractions(s, effectiveLang, opts.contractions && opts.tone !== 'formal');

        // shorten sentences if needed
        if(opts.shorten && s.length > 120 && rnd() < 0.95 * (opts.strength || 1)){
          s = shortenSentence(s, effectiveLang);
        }

        // tone-specific small tweaks (avoid changing visual shape):
        if(opts.tone === 'friendly' && rnd() < 0.12 * (opts.strength || 1)){
          // add short parenthetical or short tag (no em-dash)
          if(effectiveLang === 'en'){
            if(rnd() < 0.5) s = s.replace(/([.!?])?$/,' (just FYI).');
            else s = s.replace(/([.!?])?$/, ', just saying.');
          } else {
            if(rnd() < 0.5) s = s.replace(/([.!?])?$/,' (ter info).');
            else s = s.replace(/([.!?])?$/, ', even ter info.');
          }
        }

        // formal tone: avoid contractions & prefer precise synonyms
        if(opts.tone === 'formal'){
          // ensure no contractions (we already avoided applying when tone=formal)
          s = s.replace(/\bI'm\b/gi,'I am').replace(/\byou're\b/gi,'you are');
        }

        // ensure punctuation
        if(!/[.!?]$/.test(s)) s = s + '.';
        return s;
      });

      const newCore = sents.join(' ');
      return leading + newCore + trailing;
    });

    return smoothOutput(outLines.join('\n'));
  }

  // expose
  return {
    humanise,
    seed
  };
})();
