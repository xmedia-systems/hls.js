const testsContext = require.context('./integration', true);
testsContext.keys().forEach(testsContext);

export default testsContext;
