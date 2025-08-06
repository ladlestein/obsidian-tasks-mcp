#!/usr/bin/env node

console.log('Debug test starting...');

function testFunction() {
  console.log('This is a test function');
  const x = 42;
  console.log('x =', x);
  return x;
}

// This is where you can set a breakpoint
const result = testFunction();
console.log('Result:', result);

console.log('Debug test finished.'); 