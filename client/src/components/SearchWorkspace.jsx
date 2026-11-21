import React, { useState } from 'react';
import { domainNames, Empty, Icon, label, modelNames, numeric, Status } from '../ui.jsx';

const suggestions = [
  { id: 'webb', title: 'Follow the James Webb telescope', description: 'Explore a subject across multiple questions.', turns: ['What is the James Webb Space Telescope?'] },
  { id: 'mercury', title: 'Disambiguate Mercury', description: 'See how the system resolves an ambiguous name.', turns: ['Tell me about Mercury'] },
  { id: 'ranking', title: 'Explore search ranking', description: 'Start with a question about information retrieval.', turns: ['How does BM25 rank documents?'] },
];
const starterIcons = ['orbit', 'branch', 'layers', 'target', 'sparkle'];

export function Welcome({ scenarios, onScenario, newTopic, disabled }) {
  const [showAll, setShowAll] = useState(false);
  const examples = scenarios.length ? scenarios : suggestions;
  const visible = showAll ? examples : examples.slice(0, 3);

  return (
    <div className="welcome">
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-label"><Icon name="sparkle" size={15} /> RESEARCH WORKSPACE</span>
          <h1>{newTopic ? 'Start a new topic.' : 'Follow the evidence.'}</h1>
          <p>{newTopic
            ? 'Ask a question to start a separate topic. You can return to other topics from the sidebar.'
            : 'Explore a topic, ask follow-up questions, and see exactly how each search finds its evidence.'}</p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <i className="art-ring ring-one" /><i className="art-ring ring-two" /><i className="art-ring ring-three" />
          <i className="axis axis-horizontal" /><i className="axis axis-vertical" />
          <i className="art-node node-one" /><i className="art-node node-two" /><i className="art-node node-three" /><i className="art-node node-four" />
          <span className="art-center"><Icon name="trace" size={29} /></span>
        </div>
      </section>

      <section className="starter-section" aria-labelledby="starter-title">
        <div className="section-heading">
          <div><h2 id="starter-title">{scenarios.length ? 'Try a scenario' : 'Try a search'}</h2>
            <p>{scenarios.length ? 'Follow a guided sequence or ask your own question below.' : 'Start with one of these questions or ask your own below.'}</p></div>
          {examples.length > 3 && <button className="text-button" type="button" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show fewer' : 'View all'} <Icon name="arrow" size={16} />
          </button>}
        </div>
        <div className="starter-grid">
          {visible.map((scenario, index) => (
            <button className="starter-card" type="button" key={scenario.id} disabled={disabled || !scenario.turns?.length} onClick={() => onScenario(scenario)}>
              <span className="starter-top">
                <span className={`starter-icon color-${index % 3}`}><Icon name={starterIcons[index % starterIcons.length]} size={22} /></span>
                <Icon name="arrowUpRight" size={17} />
              </span>
              <strong>{scenario.title}</strong>
              <span>{scenario.description}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export function Composer({ input, setInput, inputRef, settings, setSettings, semantic, busy, onSubmit, onPreview, canPreview, scenario, onNextScenario, onDismissScenario }) {
  function update(field, value) {
    setSettings(previous => ({ ...previous, [field]: value }));
  }

  const nextTurn = scenario?.turns?.[scenario.step];

  return (
    <div className="composer-dock">
      {scenario && (
        <div className="scenario-run">
          <span className="scenario-icon"><Icon name="bolt" size={17} /></span>
          <div><strong>{scenario.title}</strong><small>{nextTurn ? `Question ${scenario.step + 1} of ${scenario.turns.length}` : 'Scenario completed'}</small></div>
          {nextTurn && <button className="button compact" type="button" disabled={busy} onClick={onNextScenario}>
            <Icon name="next" size={15} /> Use next question
          </button>}
          <button className="icon-button" type="button" aria-label="Dismiss scenario" onClick={onDismissScenario}><Icon name="close" size={16} /></button>
        </div>
      )}
      <form className="composer" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
        <textarea
          ref={inputRef}
          aria-label="Search question"
          placeholder="Ask a question or follow up on a topic…"
          value={input}
          onChange={event => setInput(event.target.value)}
          rows={2}
          maxLength={2000}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <div className="composer-controls">
          <label className="control">
            <Icon name="layers" size={16} />
            <span className="visually-hidden">Retrieval model</span>
            <select disabled={busy} value={settings.model} onChange={event => update('model', event.target.value)}>
              {Object.entries(modelNames).map(([id, name]) => <option key={id} value={id} disabled={id === 'semantic' && !semantic?.available}>{name}</option>)}
            </select>
            <Icon name="down" size={13} />
          </label>
          <label className="control domain-control">
            <Icon name="target" size={16} />
            <span className="visually-hidden">Filter by domain</span>
            <select disabled={busy} value={settings.domain} onChange={event => update('domain', event.target.value)}>
              <option value="">All domains</option>
              {Object.entries(domainNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <Icon name="down" size={13} />
          </label>
          <button className={`control toggle ${settings.diversity ? 'on' : ''}`} disabled={busy} type="button"
            aria-pressed={settings.diversity} onClick={() => update('diversity', !settings.diversity)}
            title="Favor a wider variety of documents in the ranked list">
            <Icon name="sliders" size={16} /> <span>Diversity</span>
          </button>
          {canPreview && <button className="control toggle preview-control" type="button" disabled={busy} onClick={onPreview}
            aria-label="Re-score"
            title="Apply these controls to the selected turn without saving a new turn">
            <Icon name="reset" size={16} /> <span>Re-score</span>
          </button>}
          <button className="send-button" type="submit" disabled={busy || !input.trim()}>
            <span>Search</span><Icon name="arrowUp" size={18} />
          </button>
        </div>
      </form>
      <div className="composer-note">
        <span><Icon name="info" size={13} /> Searches return ranked passages from the local corpus.</span>
        <span className="keyboard-hint"><kbd>Enter</kbd> to search</span>
      </div>
    </div>
  );
}

function MarkedSnippet({ text, terms }) {
  if (!terms?.length || !text) return text;
  const valid = [...new Set(terms.filter(term => typeof term === 'string' && term.trim()))].sort((first, second) => second.length - first.length);
  if (!valid.length) return text;
  const escaped = valid.map(term => term.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&'));
  const expression = new RegExp(`(${escaped.join('|')})`, 'gi');
  return text.split(expression).map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : part);
}

function EvidenceCard({ doc, index, feedback, busy, onFeedback, onInspect }) {
  const isRelevant = feedback?.relevant?.includes(doc.docId);
  const isIrrelevant = feedback?.irrelevant?.includes(doc.docId);
  const isPinned = feedback?.pinned?.includes(doc.docId);
  const [expanded, setExpanded] = useState(false);
  const snippet = doc.snippet || doc.body || '';
  return (
    <article className="evidence-card">
      <div className="evidence-head">
        <span className="rank-index">{String(index + 1).padStart(2, '0')}</span>
        <div className="evidence-title">
          <h3>{doc.title}</h3>
          <div className="result-tags">
            {doc.domain && <span>{domainNames[doc.domain] ?? label(doc.domain)}</span>}
            {doc.origins?.map(origin => <span key={origin} className={origin === 'pinned' ? 'lime-tag' : ''}>{label(origin)}</span>)}
          </div>
        </div>
        <button className="score-button" type="button" onClick={() => onInspect(doc)} aria-label={`Inspect ranking score for ${doc.title}`}>
          <span>{numeric(doc.score)}</span><Icon name="panel" size={15} />
        </button>
      </div>
      <p className="snippet"><MarkedSnippet text={expanded ? doc.body : snippet} terms={doc.highlights} /></p>
      <div className="evidence-actions">
        {doc.body && doc.body !== snippet && <button className="text-button inline-button" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Collapse passage' : 'Read passage'} <Icon name={expanded ? 'close' : 'down'} size={14} />
        </button>}
        <div className="feedback-actions" aria-label="Evidence feedback">
          <button type="button" className={`icon-button ${isRelevant ? 'pressed' : ''}`} title="Mark relevant" aria-label="Mark relevant"
            disabled={busy} aria-pressed={Boolean(isRelevant)} onClick={() => onFeedback(doc, isRelevant ? 'unrelevant' : 'relevant')}><Icon name="relevant" size={17} /></button>
          <button type="button" className={`icon-button ${isIrrelevant ? 'pressed' : ''}`} title="Mark irrelevant" aria-label="Mark irrelevant"
            disabled={busy} aria-pressed={Boolean(isIrrelevant)} onClick={() => onFeedback(doc, isIrrelevant ? 'unirrelevant' : 'irrelevant')}><Icon name="irrelevant" size={17} /></button>
          <button type="button" className={`icon-button ${isPinned ? 'pressed' : ''}`} title="Pin passage" aria-label="Pin passage"
            disabled={busy} aria-pressed={Boolean(isPinned)} onClick={() => onFeedback(doc, isPinned ? 'unpin' : 'pin')}><Icon name="pin" size={17} /></button>
          {(isRelevant || isIrrelevant || isPinned) && <button type="button" className="icon-button" title="Clear feedback for this passage" aria-label="Clear feedback for this passage"
            disabled={busy} onClick={() => onFeedback(doc, 'remove')}><Icon name="close" size={15} /></button>}
        </div>
      </div>
    </article>
  );
}

export function TurnResults({ turns, turn, response, preview, pending, clarification, topic, busy, onTurn, onInterpret, onCancelClarification, onPreview, onRestore, onFeedback, onInspect, onCompare }) {
  const results = response?.results;
  const query = pending || clarification?.query || turn?.query;
  const previewActive = Boolean(preview);
  const activeIndex = turns.findIndex(item => item.id === turn?.id);
  const options = clarification?.data.options ?? [];
  const feedbackCount = Object.values(topic?.feedback ?? {}).reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0);
  return (
    <div className="turn-content">
      <div className="turn-context-row">
        <span><Icon name="topic" size={17} /> {topic?.title || 'Search workspace'}</span>
        {turns.length > 0 && (
          <label className="turn-select">
            <Icon name="clock" size={15} /> <span className="visually-hidden">Browse conversation turns</span>
            <select value={turn?.id ?? ''} onChange={event => onTurn(event.target.value)} disabled={busy || Boolean(clarification)}>
              {!turn && <option value="">Choose a turn</option>}
              {turns.map((item, index) => <option value={item.id} key={item.id}>Turn {index + 1} · {item.query}</option>)}
            </select>
          </label>
        )}
      </div>
      {query && <div className="turn-query"><span>{activeIndex !== -1 && !pending && !clarification ? `QUESTION ${activeIndex + 1}` : 'YOUR QUESTION'}</span><h1>{query}</h1></div>}
      {pending && <Status kind="loading">Searching the corpus and tracing the ranking…</Status>}
      {!pending && clarification && (
        <section className="clarification">
          <span className="empty-icon"><Icon name="question" size={22} /></span>
          <div><h2>{clarification.data.question}</h2><p>Choose the meaning to use for this search.</p></div>
          <div className="clarification-options">
            {options.map(option => (
              <button className="interpretation" type="button" key={option.id} disabled={busy} onClick={() => onInterpret(option.id)}>
                <span><strong>{option.title}</strong>
                  {option.example && <small>{option.example}</small>}
                  {option.terms?.length > 0 && <small className="interpretation-terms">{option.terms.join(' · ')}</small>}</span>
                {option.docCount > 0 && <span className="count-tag">{option.docCount} passages</span>}
                <Icon name="arrow" size={17} />
              </button>
            ))}
            <button className="text-button cancel-clarification" type="button" onClick={onCancelClarification}>Cancel clarification</button>
          </div>
        </section>
      )}
      {!pending && !clarification && turn && (
        <section aria-labelledby="results-title">
          <div className="section-heading result-heading">
            <div><h2 id="results-title">Ranked evidence</h2>
              <p>{results ? `${results.length} ${results.length === 1 ? 'passage' : 'passages'}${feedbackCount ? ` · ${feedbackCount} topic feedback marks` : ''}` : 'Open a ranking preview for this saved question.'}</p></div>
            <button className="button compact" type="button" onClick={onCompare}><Icon name="compare" size={17} /> Compare</button>
          </div>
          {previewActive && <div className="preview-banner"><Icon name="bolt" size={16} /> <span>Ranking preview · Saved conversation unchanged{preview.currentTopic ? ' · Uses current topic feedback' : ''}</span>
            {onRestore && <button type="button" className="text-button" onClick={onRestore}>Saved ranking</button>}
          </div>}
          {results && results.map((doc, index) => <EvidenceCard key={doc.docId} doc={doc} index={index} feedback={topic?.feedback} busy={busy} onFeedback={onFeedback} onInspect={onInspect} />)}
          {results?.length === 0 && <Empty icon="file" title="No matching passages"><p>Try more specific terms, or remove the domain filter and re-score.</p></Empty>}
          {!results && <Empty icon="layers" title="Ranking preview available">
            <p>Retrieve evidence for this question using the saved turn.</p>
            <button className="button primary" type="button" disabled={busy} onClick={onPreview}>Preview evidence <Icon name="arrow" size={16} /></button>
          </Empty>}
        </section>
      )}
    </div>
  );
}
