// Silence RN LogBox / dev-warning noise so test output stays readable. The
// suites here exercise the pure-TS layer; none of the RN dev warnings are
// assertions we care about.
jest.spyOn(console, 'warn').mockImplementation(() => {})
