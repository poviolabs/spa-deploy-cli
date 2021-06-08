import React from 'react';

import { APP_THING, APP_RELEASE, APP_VERSION } from './config';

const App = () => (
  <>
    <div>hello world</div>
    <div>{ APP_THING }</div>
    <div>RELEASE: { APP_RELEASE }</div>
    <div>VERSION: { APP_VERSION }</div>
  </>
);
export default App;
