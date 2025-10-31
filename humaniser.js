/* humaniser.js
   Enhanced local humaniser: preserves lines/paragraphs, no em-dashes/no big lines,
   improved passive->active, seeded RNG, controlled synonym replacement.
*/
const humaniser = (function(){

  // --- seeded RNG (xorshift32) for reproducibility --- 
  let _seed = 123456789;
  function seed(s){
    _seed = s >>> 0;
    if(_seed === 0) _seed = 1;
  }
  function rnd(){ // returns [0,1)
    // xorshift32
    _seed ^= _seed << 13;
    _seed ^= _seed >>> 17;
    _seed ^= _seed << 5;
    // unsigned
    return ((_seed >>> 0) % 1000000) / 1000000;
  }

  function choose(arr, prob=0.6){
    if(!Array.isArray(arr) || arr.length === 0) return '';
    if(rnd() < prob) return arr[0];
    return arr[Math.floor(rnd()*arr.length)];
  }

  // --- dictionaries ---
  const synonyms = {
    'utilize': ['use','make use of'],
    'assist': ['help','help out'],
    'approximately': ['about','around'],
    'implement': ['put in place','set up','roll out'],
    'evaluate': ['review','check','look over','assess'],
    'recommended': ['suggested','advised'],
    'therefore': ['so','as a result'],
    'prioritize': ['focus on','put first'],
    'contact': ['reach out to','get in touch with'],
    'require': ['need','ask for']
  };

  const contractions = {
    "do not":"don't",
    "does not":"doesn't",
    "did not":"didn't",
    "cannot":"can't",
    "will not":"won't",
    "is not":"isn't",
    "are not":"aren't",
    "it is":"it's",
    "that is":"that's",
    "i am":"i'm",
    "we are":"we're",
    "you are":"you're",
    "they are":"they're",
    "we will":"we'll",
    "you will":"you'll",
    "i will":"i'll"
  };

  // helper: preserve capitalization of replacement
  function preserveCase(src, dest){
    if(!src) return dest;
    if(src.toUpperCase() === src) return dest.toUpperCase();
    if(src[0] === src[0].toUpperCase()) return dest[0].toUpperCase() + dest.slice(1);
    return dest;
  }

  // apply contractions with word boundaries, case-insensitive
  function applyContractions(s){
    for(const [k,v] of Object.entries(contractions)){
      const re = new RegExp('\\b'+escapeRegex(k)+'\\b','gi');
      s = s.replace(re, m => preserveCase(m, v));
    }
    return s;
  }

  // escape regex
  function escapeRegex(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

  // replace synonyms, but keep rate controlled and avoid over-replacing in a single sentence
  function replaceSynonyms(s, variability, strength){
    // variability: 'low'|'medium'|'high' -> map to probabilities
    const baseProb = variability === 'high' ? 0.9 : (variability === 'medium' ? 0.6 : 0.3);
    const prob = baseProb * (strength !== undefined ? strength : 1);

    // do not change inside URLs or emails
    s = s.replace(/https?:\/\/\S+|\S+@\S+/gi, function(m){ return m.replace(/./g, function(c){return '\uFFFF'+c}); });

    // track replaced count to avoid too many per sentence
    let replaced = 0;
    const maxPerSent = Math.max(1, Math.floor(2 * prob));

    s = s.replace(/\b([A-Za-z]+(?:'[A-Za-z]+)?)\b/g, (m,word)=>{
      const key = word.toLowerCase();
      if(synonyms[key] && replaced < maxPerSent && rnd() < prob){
        replaced++;
        const pick = choose(synonyms[key], 0.6);
        return preserveCase(word, pick);
      }
      return word;
    });

    // restore escaped URLs/emails
    s = s.replace(/\uFFFF(.)/g, '$1');
    return s;
  }

  // improved passive -> active conversions (multiple heuristics)
  function passiveToActive(sent){
    // 1) patterns like "The results were evaluated by the team."
    //    -> "The team evaluated the results."
    // 2) "is being reviewed by X" -> "X is reviewing"
    // 3) "was/were being VERB by AGENT" -> "AGENT was/were VERBing" (attempt)
    // We'll try multiple regexes in order.

    // Normalize trailing punctuation capture
    const trimmed = sent.trim();
    let trailing = '';
    const mTrail = trimmed.match(/([.!?]+)$/);
    if(mTrail){ trailing = mTrail[1]; }

    let core = trimmed.replace(/[.!?]+$/,'').trim();

    // pattern 2: " ... is being VERBed by AGENT"
    let re = /\b(.+?)\s+(is|are|was|were)\s+being\s+([A-Za-z0-9 \-']+?)\s+by\s+(.+?)$/i;
    let m = core.match(re);
    if(m){
      const obj = m[1].trim();
      const aux = m[2].toLowerCase();
      const verbPart = m[3].trim();
      const agent = m[4].trim();
      // make progressive: "agent [aux] [verb]-ing obj"
      // best effort: if verbPart ends with 'ed' remove 'ed' and add 'ing' — naive
      let base = verbPart.split(' ').slice(-1)[0];
      let verbIng = verbPart;
      if(/\w+ed$/i.test(base)){
        verbIng = base.replace(/ed$/i,'ing');
      } else if(!/ing$/i.test(verbPart)){
        verbIng = verbPart + 'ing';
      }
      const active = `${capitalize(agent)} ${aux} ${verbIng} ${obj}${trailing}`;
      return active;
    }

    // pattern 1: "OBJ (was|were|was not|were not) VERB by AGENT"
    re = /^\s*(.+?)\s+(?:was|were|was not|were not|is|are|has been|have been|had been)?\s*([A-Za-z0-9 \-']+?)\s+by\s+(.+?)$/i;
    m = core.match(re);
    if(m){
      const obj = m[1].trim();
      const verbPhrase = m[2].trim();
      const agent = m[3].trim();
      // if verbPhrase contains auxiliaries like 'evaluated' or 'reviewed', use as-is
      // Construct: "Agent [verbPhrase] obj."
      const active = `${capitalize(agent)} ${verbPhrase} ${obj}${trailing}`;
      return active;
    }

    // fallback: no change
    return sent;
  }

  // shorten long sentences heuristically
  function shortenSentence(sent){
    // preserve leading/trailing spaces
    const s = sent.trim();
    if(s.length < 120) return sent;
    // try to split by semicolon or comma into two sentences; prefer splits near the start
    if(s.indexOf(';') > -1){
      const parts = s.split(';').map(p=>p.trim()).filter(Boolean);
      return parts.slice(0,2).map(p=>capitalize(stripLeadingLowercase(p)) + '.').join(' ');
    }
    if(s.indexOf(',') > -1){
      const parts = s.split(',').map(p=>p.trim()).filter(Boolean);
      return parts.slice(0,2).map(p=>capitalize(stripLeadingLowercase(p)) + '.').join(' ');
    }
    // split by ' and ' or ' but '
    const andParts = s.split(/\s+(and|but)\s+/i);
    if(andParts.length>1){
      // andParts contains separators, rebuild first two chunks
      const first = andParts[0].trim();
      const second = andParts.slice(2).join(' ').trim();
      return [capitalize(first)+'.', capitalize(second)+'.'].join(' ');
    }
    // hard cut fallback
    return s.slice(0, 100).trim() + '...';
  }

  function stripLeadingLowercase(s){
    return s.replace(/^[a-z]/, (m)=>m.toUpperCase());
  }

  function capitalize(s){
    if(!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // sentence splitter that keeps punctuation, but we'll operate per original line
  function splitSentences(text){
    // capture sentences by punctuation . ? !
    const matches = text.match(/[^.!?]+[.!?]?/g);
    if(!matches) return [text];
    return matches.map(m => m.trim()).filter(Boolean);
  }

  // small cleanup pass
  function smoothOutput(text){
    return text
      .replace(/\s+([.,!?;:])/g, '$1')    // no space before punctuation
      .replace(/([.,!?;:])([^\s])/g, '$1 $2') // ensure space after punctuation
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  // preserve line layout: process each line separately
  function humanise(text, options = {}){
    if(!text) return '';

    // default options
    const opts = Object.assign({
      tone: 'casual',       // casual | friendly | formal
      variability: 'medium',// low | medium | high
      contractions: true,
      shorten: true,
      strength: 1.0         // 0..1 multiplier for strength
    }, options);

    // map variability to internal probability
    const varMap = { low: 'low', medium: 'medium', high: 'high' };

    // We preserve line breaks EXACTLY. We'll treat each physical line separately.
    // This keeps the "shape" of the text.
    const lines = text.split(/\r\n|\n/);

    const outLines = lines.map(line => {
      // preserve leading/trailing whitespace for the line
      const leading = (line.match(/^\s*/)||[''])[0];
      const trailing = (line.match(/\s*$/)||[''])[0];
      const core = line.trim();

      if(core === '') return leading + '' + trailing; // blank line preserved

      // split into sentences
      let sents = splitSentences(core);

      // process each sentence
      sents = sents.map(sent => {
        let s = sent.trim();

        // capitalization normalization (but preserve internal caps)
        s = s.charAt(0).toUpperCase() + s.slice(1);

        // passive -> active with some probability depending on variability & strength
        const passiveProb = (opts.variability === 'high' ? 0.6 : opts.variability === 'medium' ? 0.35 : 0.15) * (opts.strength || 1);
        if(rnd() < passiveProb){
          const converted = passiveToActive(s);
          if(converted && converted.length && converted !== s) s = converted;
        }

        // synonyms
        s = replaceSynonyms(s, varMap[opts.variability] || 'medium', opts.strength);

        // contractions (only if allowed and not formal)
        if(opts.contractions && opts.tone !== 'formal' && rnd() < 0.9 * (opts.strength || 1)){
          s = applyContractions(s);
        } else if(opts.tone === 'formal'){
          // expand a few common contractions back (if present)
          s = s.replace(/\bI'm\b/gi, 'I am').replace(/\byou're\b/gi, 'you are');
        }

        // shorten sentences if requested
        if(opts.shorten && s.length > 120 && rnd() < 0.9 * (opts.strength || 1)){
          s = shortenSentence(s);
        }

        // small friendly suffixes for 'friendly' tone (but keep them short)
        if(opts.tone === 'friendly' && rnd() < 0.15 * (opts.strength || 1)){
          // add a short tag like "— just saying." would be dashy, so we use parentheses or comma
          if(rnd() < 0.5) {
            s = s.replace(/([.!?])?$/, ', just saying.');
            // ensure punctuation
            if(!/[.!?]$/.test(s)) s = s + '.';
          } else {
            s = s + ' (just FYI).';
          }
        }

        // final cleanup punctuation spacing
        s = s.replace(/\s+\./g, '.').replace(/\s+,/g, ',').trim();
        // ensure sentence ends in punctuation
        if(!/[.!?]$/.test(s)) s = s + '.';
        return s;
      });

      // rejoin sentences with a single space (preserves line length roughly)
      const newCore = sents.join(' ');
      return leading + newCore + trailing;
    });

    // restore spacing and smooth
    return smoothOutput(outLines.join('\n'));
  }

  // expose methods
  return {
    humanise,
    seed
  };
})();
