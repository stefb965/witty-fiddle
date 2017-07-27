import './WebApp.css';
import 'bootstrap/dist/css/bootstrap.css';
import 'codemirror/lib/codemirror.css';
import 'codemirror/mode/javascript/javascript';
import 'codemirror/theme/solarized.css';
import CodeMirror from 'react-code-mirror';
import query from 'url-query';
import React, {PropTypes} from 'react';
import uuid from 'uuid';
import Wit from 'node-wit/lib/wit';
import firebase from 'firebase';
import {OverlayTrigger, Tooltip} from 'react-bootstrap'

// ------------------------------------------------------------
// Config

const WITTY_DEPLOY_URI = 'https://stopachka.github.io/witty-deploy';
const DEFAULT_ID = '5a387f6ccb4be4a1f77f2113747a558a';

// Dev
// const WITTY_DEPLOY_URI = 'http://localhost:3001';

// ------------------------------------------------------------
// helpers

function user(text) {
  return {type: 'user', payload: {text}};
}

function bot(name, args) {
  return {type: 'bot', payload: {name, args}};
}

function integration(name, args) {
  return {type: 'integration', payload: {name, args}};
}

function forChat({type, payload}) {
  return (
    (type === 'user') ||
    (type === 'integration')
  );
}

function values(obj) {
  return Object.keys(obj).map(k => obj[k]);
}

function mapObject(obj, f) {
  return Object
    .keys(obj)
    .map(k => [k, f(obj[k], k)])
    .reduce(
      (newObj, [k, v]) => {
        newObj[k] = v;
        return newObj;
      },
      {}
    )
  ;
}

function debounce(f, ms) {
  let timeout = null;
  return function(...args) {
    clearTimeout(timeout);
    timeout = window.setTimeout(
      () => f(...args),
      ms
    );
  }
}

function parseJSON(res) {
  return res.json().then(
    json => res.ok ? json : Promise.reject(json)
  );
}

class WitTooltip extends React.Component {
  static propTypes = {
    placement: PropTypes.string,
    tooltip: PropTypes.node,
    children: PropTypes.node.isRequired,
    trigger: PropTypes.array,
    defaultOverlayShown: PropTypes.bool,
  }
  static defaultProps = {
    placement: 'top',
    trigger: ['hover', 'focus'],
    defaultOverlayShown: false,
  }
  constructor(props) {
    super(props);
    this.id = props.id || uuid.v4();
  }
  render() {
    const {tooltip, tooltipClassname, children, ...rest} = this.props;
    return (
      <OverlayTrigger
        {...rest}
        overlay={
          <Tooltip
            id={this.id}
            style={tooltip ? {} : {display: 'none'}}
            className={tooltipClassname}>
            {tooltip}
          </Tooltip>
        }>
        {children}
      </OverlayTrigger>
    );
  }
}

// ------------------------------------------------------------
// Cache

function createCache(storageKey, limit) {
  const read = () => {
    const vs = localStorage.getItem(storageKey);
    return vs ? JSON.parse(vs) : [];
  };
  const save = (vs) => {
    const withLimit = vs.slice(vs.length - limit, vs.length);
    localStorage.setItem(storageKey, JSON.stringify(withLimit));
  }
  return {
    read,
    get(k) {
      const vs = read();
      // eslint-disable-next-line
      const [_, v] = vs.find(([key, v]) => key === k) || [];
      return v;
    },
    byIndex(i) {
      const vs = read();
      // eslint-disable-next-line
      const [_, v] = vs[i] || [];
      return v;
    },
    set(newK, newV) {
      const vs = read();
      const withNewV = vs
        .filter(([k, v]) => k !== newK)
        .concat([[newK, newV]])
      ;
      save(withNewV);
    },
  };
}

function createHistory(storageKey, limit) {
  const cache = createCache(storageKey, limit);
  let i = cache.read().length;
  return {
    up() {
      i = Math.max(i - 1, 0);
      return cache.byIndex(i);
    },
    down() {
      const vs = cache.read();
      i = Math.min(i + 1, vs.length - 1);
      return cache.byIndex(i);
    },
    push(v) {
      cache.set(uuid.v4(), v);
      i = cache.read().length;
    }
  }
}

// ------------------------------------------------------------
// API

function wrapActions(actions, cb) {
  return mapObject(
    actions,
    (f, k) => (request, ...rest) => {
      const withId = {...request, fbid: request.sessionId};
      const args = [withId, ...rest];
      cb(bot(k, args));
      return f(...args);
    },
  );
}

function exposeActions(code) {
  return `
    ${code};
    actions;
  `;
}

const defaultIntegration = {
  messengerSend() {},
  firebase,
}

function evalActions(code, integ) {
  const integration = {...defaultIntegration, ...integ};
  // require is used in eval
  // eslint-disable-next-line
  const require = (k) => {
    if (integration[k]) {
      return integration[k];
    } else {
      throw new Error(`${k} is not a valid module`)
    }
  }
  return new Promise((resolve, reject)  => {
    try {
      // eslint-disable-next-line
      resolve(eval(exposeActions(code)));
    } catch(e) {
      reject(e);
    }
  });
}

function actionsWithLogs(code, cb) {
  return evalActions(
    code,
    {
      messengerSend(...args) {
        cb(integration('send', args));
      },
    }
  ).then(actions => wrapActions(actions, cb));
};

function sendText(text, accessToken, sessionId, context, code) {
  const logs = [];
  return actionsWithLogs(
    code,
    log => logs.push(log)
  ).then(actions => {
    const engine = new Wit({accessToken, actions});
    return engine.runActions(
      sessionId,
      text,
      context,
    ).then(context => {
      return {context, logs};
    });
  });
}

function save(token, code, meta) {
  return fetch(
    'https://api.github.com/gists',
    {
      method: 'POST',
      body: JSON.stringify({
        description: 'wit.ai bot engine app',
        public: true,
        files: {
          'wit-token': {content: token},
          'actions.js': {content: code},
          'meta.json': {content: JSON.stringify(meta)}
        },
      })
    }
  )
  .then(parseJSON)
  .then(res => res.id)
}

const gistCache = createCache('gists', 100);

function retrieve(id) {
  const found = gistCache.get(id);
  if (found) return Promise.resolve(found);
  return fetch(`https://api.github.com/gists/${id}`)
    .then(parseJSON)
    .then(({files}) => {
      const contentFor = (str) => files[str] && files[str].content
      return {
        code: contentFor('actions.js'),
        token: contentFor('wit-token'),
        meta: JSON.parse(contentFor('meta.json') || '{}'),
      };
    }).then(gistInfo => {
      gistCache.set(id, gistInfo);
      return gistInfo;
    })
  ;
}

function tokenInfo(token) {
  return fetch(
    `https://api.wit.ai/token`,
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  ).then(parseJSON)
}

const instanceURI = ({appname, username}) => {
  return appname && username
    ? `https://wit.ai/${username}/${appname}`
    : null
}

const urlFor = (id) => {
  return window.location.pathname + `?id=${id}`;
}

const readId = (q) => {
  return q && query(q)['id'];
}

// ------------------------------------------------------------
// Components

class Payload extends React.Component {
  static propTypes = {
    title: PropTypes.string,
    body: PropTypes.object.isRequired,
  }
  render() {
    const {title, body} = this.props;
    return (
      <div className="WebApp-payload-root">
        <div className="WebApp-payload-title">
          {title}
        </div>
        <div className="WebApp-payload-body">
          <CodeMirror
            className="WebApp-action-editor-code-mirror"
            value={JSON.stringify(body, null, 2)}
            mode="javascript"
            theme="solarized light"
            lineNumbers={false}
            readOnly="nocursor"
          />
        </div>
      </div>
    );
  }
}

function BotPayload({title = 'Send to messenger ->', body}) {
  return (
    <div className="WebApp-bot-payload">
      <Payload title={title} body={body} />
    </div>
  );
}

function LogPayload({title, body}) {
  return (
    <div className="WebApp-log-payload">
      <Payload title={title} body={body} />
    </div>
  );
}

function Bubble({className, children}) {
  return (
    <div className={`WebApp-bubble-container ${className}`}>
      <div className="WebApp-bubble">{children}</div>
    </div>
  );
}

class ChatMessage extends React.Component {
  static propTypes = {
    message: PropTypes.object.isRequired,
  };
  render() {
    const {type, payload} = this.props.message;
    switch (type) {
      case 'user':
        return <Bubble className="WebApp-user-bubble">{payload.text}</Bubble>
      case 'integration':
        const {args: [arg]} = payload;
        const message = arg && arg.message;
        const justText = (
          message &&
          Object.keys(message).length === 1 &&
          message.text
        );
        return justText
          ? <Bubble className="WebApp-bot-bubble">{message.text}</Bubble>
          : <BotPayload body={arg} />
        ;
      default:
        return null;
    }
  }
}

class LogItem extends React.Component {
  static propTypes = {
    comment: PropTypes.string.isRequired,
    value: PropTypes.oneOfType([PropTypes.string, PropTypes.object]).isRequired,
  }
  render() {
    const {comment, value} = this.props;
    return (
      <div className="WebApp-log-item">
        <div className="WebApp-log-comment">
          // {comment}
        </div>
        <div className="WebApp-log-value">
          {
            typeof value === 'string'
              ? value
              : JSON.stringify(value)
          }
        </div>
      </div>
    );
  }
}

class EntityInfo extends React.Component {
  static propTypes = {
    req: PropTypes.object.isRequired,
  }
  render() {
    const entities = this.props.req.entities || [];
    const names = Object.keys(entities).join(', ');
    return names
      ? <LogPayload
          title={`Entities: ${names}`}
          body={entities}
        />
      : null
  }
}
class LogMessage extends React.Component {
  static propTypes = {
    message: PropTypes.object.isRequired,
  }
  render() {
    const {type, payload} = this.props.message;
    switch (type) {
      case 'user':
        return (
          <div>
            <LogItem comment="user sends:" value={payload} />
            <div className="WebApp-log-break">
              asking wit what to do next...
            </div>
          </div>
        );
      case 'bot':
        const [req, res] = payload.args;
        return (
          <div>
            <EntityInfo req={req} />
            {
              payload.name === 'send'
                ? <LogItem comment="bot sends:" value={res} />
                : <LogItem comment="bot executes:" value={`> ${payload.name}()`} />
            }
          </div>
        );
      case 'integration':
      default:
        return null;
    }
  }
}

class EmptyMessage extends React.Component {
  static propTypes = {
    message: PropTypes.string.isRequired,
  }
  render() {
    const {message} = this.props;
    return (
      <div className="WebApp-empty-message">{message}</div>
    );
  }
}

class Chat extends React.Component {
  static propTypes = {
    inputValue: PropTypes.string.isRequired,
    onInputChange: PropTypes.func.isRequired,
    onInputKeyDown: PropTypes.func.isRequired,
    onReset: PropTypes.func.isRequired,
    messages: PropTypes.array.isRequired,
  }
  componentDidMount() {
    this.focus();
  }
  componentDidUpdate(prevProps) {
    if (prevProps.messages !== this.props.messages) {
      this.scrollToBottom();
    }
  }
  focus() {
    if (this._input) { this._input.focus(); }
  }
  scrollToBottom() {
    if (this._list) { this._list.scrollTop = this._list.scrollHeight; }
  }
  render() {
    const {
      inputValue, messages, onInputChange, onInputKeyDown, onReset
    } = this.props;
    return (
      <div className="WebApp-chat-root">
        {
          messages.length
          ? <div ref={x => {this._list = x}} className="WebApp-chat-list">
              {
                messages
                  .filter(forChat)
                  .map((m, idx) => <ChatMessage key={idx} message={m} />)
              }
            </div>
          : <EmptyMessage message="Type something..." />
        }
        <div>
          <input
            ref={x => {this._input = x}}
            className="WebApp-chat-composer"
            placeholder="Chat with your bot here..."
            onChange={onInputChange}
            onKeyDown={onInputKeyDown}
            value={inputValue}
          />
          <div className="WebApp-chat-composer-info">
            Click <button onClick={onReset}>Reset</button> to start fresh
          </div>
        </div>
      </div>
    );
  }
}

class Log extends React.Component {
  static propTypes = {
    messages: PropTypes.array.isRequired,
  }
  componentDidUpdate(prevProps) {
    if (prevProps.messages !== this.props.messages) {
      this.scrollToBottom();
    }
  }
  scrollToBottom() {
    if (this._list) { this._list.scrollTop = this._list.scrollHeight; }
  }
  render() {
    const {messages} = this.props;
    return (
      <div ref={x => { this._list = x; }} className="WebApp-log-root">
        {
          messages.length
            ? messages.map((m, idx) => <LogMessage key={idx} message={m} />)
            : <EmptyMessage message="Logs..." />
        }
      </div>
    );
  }
}

class ErrorPanel extends React.Component {
  static propTypes = {
    errors: PropTypes.object.isRequired,
  }
  render() {
    const errors = values(this.props.errors).filter(x => x);
    if (!errors.length) return null;
    return (
      <div className="WebApp-error-panel-root">
        <h2 className="WebApp-error-panel-title">Oops :\</h2>
        <div className="WebApp-error-panel-items">
          {
            errors.map((msg, idx) => (
              <div key={idx} className="WebApp-error-panel-item">{msg}</div>
            ))
          }
        </div>
      </div>
    );
  }
}

class Container extends React.Component {
  static propTypes = {
    children: PropTypes.node.isRequired,
  }
  render() {
    return (
      <div className="WebApp-container-root">
        {this.props.children}
      </div>
    );
  }
}


class ContainerTitle extends React.Component {
  static propTypes = {
    children: PropTypes.node.isRequired,
  }
  render() {
    return (
      <h3 className="WebApp-container-title">
        {this.props.children}
      </h3>
    );
  }
}

class Arrows extends React.Component {
  static propTypes = {
    directions: PropTypes.arrayOf(
      PropTypes.oneOf(['right-to-left', 'left-to-right'])
    ),
    children: PropTypes.node.isRequired,
  }
  render() {
    const {directions, children} = this.props;
    return (
      <div className="WebApp-arrows-root">
        {
          directions.reduce(
            (child, dir) =>
              <div className={`WebApp-arrow-${dir}`}>
                {child}
              </div>
            ,
            children,
          )
        }
      </div>
    );
  }
}

function TokenPicker({token, onChange}) {
  return (
    <div className="WebApp-token-picker-root">
      <input
        value={token || ''}
        onChange={e => onChange(e.target.value)}
        className="WebApp-token-picker-input"
      />
    </div>
  );
}

TokenPicker.propTypes = {
  token: PropTypes.string,
  onChange: PropTypes.func.isRequired,
};

class CodeStatus extends React.Component {
  static propTypes = {
    error: PropTypes.string
  }
  render() {
    const {error} = this.props;
    const happyEmoji = '\uD83D\uDE01';
    return (
      <div className={`
        WebApp-code-status-root
        ${error ? 'WebApp-code-status-error' : ''}
      `}>
        <div className="WebApp-code-status-sign"></div>
        <div className="WebApp-code-status-message">
          {
            error || `Code checks out ${happyEmoji}`
          }
        </div>
      </div>
    );
  }
}

class ActionEditor extends React.Component {
  static propTypes = {
    code: PropTypes.string,
    onChange: PropTypes.func.isRequired,
    onSave: PropTypes.func.isRequired,
  }
  render() {
    const {code, onSave} = this.props;
    return (
      <CodeMirror
        className="WebApp-action-editor-code-mirror"
        value={code}
        mode="javascript"
        theme="solarized light"
        lineNumbers={true}
        onChange={this._onChange}
        extraKeys={{
          'Tab': (codeMirror) => {
            codeMirror.replaceSelection('  ');
          },
          'Ctrl-S': onSave,
          'Cmd-S': onSave,
        }}
      />
    );
  }
  _onChange = (e) => {
    this.props.onChange(e.target.value);
  }
}

class PreviousVersions extends React.Component {
  static propTypes = {
    currentVersion: PropTypes.string,
    versions: PropTypes.arrayOf(PropTypes.string).isRequired,
  }
  render() {
    const {versions} = this.props;

    return (
      <div className="WebApp-versions-root">
        {versions
          .map((id, i) => (
            <a key={id} className="WebApp-versions-list-item" href={urlFor(id)}>
              v{i}
            </a>
          ))
          .reverse()}
      </div>
    );
  }
}

function Loading() {
  return (
    <div className="WebApp-loading-container">
      <div className="spinner"></div>
    </div>
  )
}

const emptyMessageState = () => ({
  errors: {},
  inputValue: '',
  messages: [],
  sessionId: uuid.v4(),
});

const emptyState = () => ({
  ...emptyMessageState(),
  code: '',
  originalCode: '',
  meta: {
    previousVersions: [],
  },
  store: {},
  showDeploy: false,
  token: '',
});

const composerHistory = createHistory('composer-history', 100);

export default class WebApp extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      ...emptyState(),
      loading: true,
    }
    this._checkCode = debounce(this._checkCode, 2000);
    this._k = uuid.v4();
  }
  componentDidMount() {
    window.fbAsyncInit = this._init;
    (function(d, s, id){
       var js, fjs = d.getElementsByTagName(s)[0];
       if (d.getElementById(id)) {return;}
       js = d.createElement(s); js.id = id;
       js.src = "//connect.facebook.net/en_US/sdk.js";
       fjs.parentNode.insertBefore(js, fjs);
     }(document, 'script', 'facebook-jssdk'));
  }
  componentDidUpdate(_, prevState) {
    const codeChanged = prevState.code !== this.state.code;
    const tokenChanged = prevState.token !== this.state.token;
    if (codeChanged) {
      this._checkCode();
    }
    if (codeChanged || tokenChanged) {
      this._transferToDeploy();
    }
  }
  _init = () => {
    window.FB.init({
      appId      : '338842666497038',
      xfbml      : true,
      version    : 'v2.6'
    });
    window.FB.AppEvents.logPageView();

    const q = window.location.search;
    const id = readId(q) || DEFAULT_ID;
    window.history.replaceState('', '', urlFor(id));

    retrieve(id).then(({meta, code, token}) => {
      this.setState({
        meta,
        code,
        token,
        originalCode: code,
        originalToken: token,
        loading: false,
      });
    });
    window.addEventListener(
      'message',
      (e) => {
        const {type, k} = e.data || {};
        if (type === 'request-code' && k === this._k) {
          this._transferToDeploy();
        }
      }
    );
    window.onbeforeunload = () => {
      const {code, originalCode} = this.state;
      if (code !== originalCode) {
        return 'Are you sure? Your changes may not be saved';
      };
    }
  }
  _transferToDeploy() {
    if (this._iframe) {
      this._iframe.contentWindow.postMessage({
        type: 'send-code',
        k: this._k,
        payload: {
          code: this.state.code,
          token: this.state.token,
        }
      }, '*')
    }
  }
  render() {
    const {
      inputValue, messages, errors, token, originalToken, code, originalCode,
      showDeploy, meta, sessionId, store, loading
    } = this.state;
    if (loading) {
      return <Loading />;
    }
    const encourageClone = !errors.code && (
      (originalCode !== code) || (originalToken !== token)
    );
    return (
      <div className="WebApp-root">
        {
          showDeploy
            ? <div className="WebApp-deploy-root">
                <button
                  className="WebApp-button WebApp-close-deploy-button"
                  onClick={() => this.setState({showDeploy: false})}>
                  Close
                </button>
                <iframe
                  ref={x => {this._iframe = x}}
                  className="WebApp-deploy-iframe"
                  src={`${WITTY_DEPLOY_URI}/?k=${this._k}`}
                />
              </div>
            : null
        }
        <div className="WebApp-notice-root">
          <h4 className="WebApp-notice-text">
            Stories is deprecated and will shut down on February 1, 2018.
            Learn more about why and how to migrate
            {' '}
            <a
              href="https://wit.ai/blog/2017/07/27/sunsetting-stories"
              target="blank">
              here
            </a>
            .
          </h4>
        </div>
        <div className="WebApp-header">
          <div className="WebApp-header-main">
            <h1 className="WebApp-header-title">wittyfiddle</h1>
            <WitTooltip
              placement="right"
              tooltip={
                token
                  ? 'Wit token'
                  : 'You need to provide a wit token'
              }>
              <div className={
                token ? '' : 'WebApp-token-picker-empty'
              }>
                <TokenPicker
                  token={token}
                  onChange={this._onTokenChange}
                />
              </div>
            </WitTooltip>
            {
              token &&
                <button
                  className="WebApp-see-stories-button"
                  onClick={() => this._onSeeStory(token)}>
                  (See Stories)
                </button>
            }
          </div>
          <div className="WebApp-header-side">
            {
              meta.previousVersions && meta.previousVersions.length
                ? <PreviousVersions versions={meta.previousVersions} />
                : null
            }
            <div className="WebApp-header-side">
              <WitTooltip
                placement="bottom"
                tooltip={
                  encourageClone && 'Press Save & Clone to save your changes'
                }>
                <button
                  className={`
                    WebApp-button
                    WebApp-clone-button
                    ${encourageClone ? 'WebApp-clone-button-changed' : ''}
                  `}
                  onClick={this._onClone}>
                  Save & Clone
                </button>
              </WitTooltip>
              <button
                disabled={encourageClone}
                className="WebApp-button"
                onClick={() => this.setState({showDeploy: true})}>
                Deploy
              </button>
            </div>
          </div>
        </div>
        <ErrorPanel errors={{...errors, code: null}} />
        <div className="WebApp-body">
          <div className="WebApp-sidebar-root">
            <input
              placeholder="Name your fiddle"
              className="WebApp-sidebar-input"
              value={meta.title || ''}
              onChange={this._onTitleChange}
            />
            <a
              className="WebApp-sidebar-gist-link"
              target="_blank"
              href={
                `https://gist.github.com/${readId(window.location.search)}`
              }>
              View as gist
            </a>
          </div>
          <div className="WebApp-sandbox-root">
            <div className="WebApp-sandbox-wrapper">
              <div className="WebApp-sandbox-main">
                <Container>
                  <Arrows directions={['right-to-left']}>
                    <ContainerTitle>Chat Bot</ContainerTitle>
                  </Arrows>
                  <Chat
                    inputValue={inputValue}
                    onInputChange={this._onInputChange}
                    onInputKeyDown={this._onInputKeyDown}
                    onReset={this._onReset}
                    messages={messages}
                  />
                </Container>
                <Container>
                  <Arrows directions={['left-to-right']}>
                    <ContainerTitle>Logs</ContainerTitle>
                  </Arrows>
                  <Log messages={messages} />
                </Container>
              </div>
              <div className="WebApp-sandbox-context">
                <LogPayload
                  title="Context"
                  body={store[sessionId] || {}}
                />
              </div>
            </div>
          </div>
          <div className="WebApp-action-editor-root">
            <div className="WebApp-action-editor-title">
              <Arrows directions={['left-to-right', 'right-to-left']}>
                <ContainerTitle>Actions</ContainerTitle>
              </Arrows>
            </div>
            <CodeStatus error={errors['code']} />
            <ActionEditor
              code={code}
              onChange={this._onCodeChange}
              onSave={this._onClone}
            />
          </div>
        </div>
      </div>
    );
  }
  _checkCode = () => {
    evalActions(this.state.code)
      .then(() => this._setError({code: null}))
      .catch((e) => this._setError({code: `${e.name}: ${e.message}`}));
  }
  _onTitleChange = (e) => {
    const title = e.target.value;
    this.setState(({meta}) => ({meta: {...meta, title}}));
  }
  _onCodeChange = (code) => {
    this.setState({code});
  }
  _onTokenChange = (newToken) => {
    if (newToken === this.state.token) return;
    this.setState({
      ...emptyMessageState(),
      token: newToken,
    });
  }
  _onInputChange = (e) => {
    this.setState({inputValue: e.target.value});
  }
  _onInputKeyDown = (e) => {
    switch (e.key) {
      case 'Enter':
        const value = this.state.inputValue.trim();
        this.setState({inputValue: ''});
        this._sendText(value);
        break;
      case 'ArrowUp':
        const upText = composerHistory.up();
        if (upText) { this.setState({inputValue: upText}) }
        break;
      case 'ArrowDown':
        const downText = composerHistory.down();
        if (downText) { this.setState({inputValue: downText}) }
        break;
      default:
        return;
    }
  }
  _onReset = () => {
    this.setState(emptyMessageState());
  }
  _sendText = (userText) => {
    window.FB.AppEvents.logEvent('sentTextViaBrowser', 1);
    const {token, code, sessionId, store} = this.state;
    const context = store[sessionId] || {};
    const addMessages = (ms) => this.setState(
      ({messages}) => ({messages: [...messages, ...ms]}),
    );
    addMessages([user(userText)]);
    sendText(userText, token, sessionId, context, code)
      .then(({context, logs}) => {
        composerHistory.push(userText);
        addMessages(logs);
        this.setState(({store}) => ({store: {...store, [sessionId]: context}}));
      })
      .then(
        _ => this._setError({api: null}),
        err => this._setError({
          api: err.message || 'Wit failed to send actions'
        })
      )
    ;
  }
  _setError = (kv) => {
    this.setState(({errors}) => ({errors: {...errors, ...kv}}));
  }
  _onClone = () => {
    const {token, code, meta} = this.state;
    const currentId = readId(window.location.search);
    const previousVersions = (meta.previousVersions || []).concat(currentId);
    const newMeta = {...meta, previousVersions};
    window.FB.AppEvents.logEvent('startedCloneFiddle', 1, {currentId});
    save(token, code, newMeta).then(id => {
      window.FB.AppEvents.logEvent(
        'finishedCloneFiddle',
        1,
        {currentId, newId: id}
      );
      this.setState({originalCode: code, originalToken: token, meta: newMeta});
      window.history.pushState('', '', urlFor(id));
    });
  }
  _onSeeStory = (token) => {
    window.FB.AppEvents.logEvent('startedSeeStory', 1, {token});
    tokenInfo(token).then((res) => {
      const uri = instanceURI(res);
      window.FB.AppEvents.logEvent('finishedSeeStory', 1, {token, uri});
      if (uri) { window.open(uri); }
    });
  }
}
