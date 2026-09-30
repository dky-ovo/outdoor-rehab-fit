import * as React from 'react';
import { act } from 'react';
import renderer from 'react-test-renderer';

import { ThemedText } from '../ThemedText';

it(`renders correctly`, async () => {
  let tree: ReturnType<typeof renderer.create>;
  await act(async () => { tree = renderer.create(<ThemedText>Snapshot test!</ThemedText>); });
  expect(tree!.toJSON()).toMatchSnapshot();
  await act(async () => tree!.unmount());
});
