import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { TouchableOpacity, Text, TextInput } from 'react-native';
import AdminAiConfiguration from '../AdminAiConfiguration';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree;
afterEach(async () => { if(tree) await act(async()=>tree.unmount()); tree=null; });
const textOf = node => node.findAllByType(Text).map(x=>x.props.children).flat(Infinity).join('');
const button = label => tree.root.findAllByType(TouchableOpacity).find(x=>textOf(x)===label);
const configuration={provider:'deepseek',activeProvider:'deepseek',model:'deepseek-v4-flash',apiKey:'draft-deepseek-key',apiKeyConfigured:true,
  profiles:{bailian:{model:'qwen3-14b-1f1a8952705b',baseUrl:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',apiKeyConfigured:true}}};
async function mount(overrides={}) { const props={configuration,onChange:jest.fn(),onSave:jest.fn(),onTest:jest.fn(),styles:{},...overrides}; await act(async()=>{tree=renderer.create(<AdminAiConfiguration {...props}/>);}); return props; }
test('selecting Bailian preserves the independent DeepSeek draft, and connection test does not activate',async()=>{
  const p=await mount(); await act(async()=>button('阿里百炼').props.onPress());
  expect(p.onChange).toHaveBeenCalledWith({...configuration,provider:'bailian'});
  expect(p.onSave).not.toHaveBeenCalled();
  await act(async()=>button('测试所选模型连接').props.onPress());
  expect(p.onTest).toHaveBeenCalledTimes(1); expect(p.onSave).not.toHaveBeenCalled();
});
test('Bailian settings expose server configuration without an editable secret or DeepSeek prompt options',async()=>{
  await mount({configuration:{...configuration,provider:'bailian'}});
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  const text=textOf(tree.root);expect(text).toContain('qwen3-14b-1f1a8952705b');expect(text).toContain('应用提示词：关闭 · FAQ：关闭');
  expect(text).not.toContain('draft-deepseek-key');expect(button('保存并切换至阿里百炼').props.disabled).toBeFalsy();
});
test('Bailian cannot be activated until its server key is configured',async()=>{
  await mount({configuration:{...configuration,provider:'bailian',profiles:{bailian:{apiKeyConfigured:false}}}});
  expect(button('保存并切换至阿里百炼').props.disabled).toBe(true);
});

test('DeepSeek-only mode removes provider switching and all Bailian setup copy',async()=>{
  const p=await mount({configuration:{...configuration,providerMode:'deepseek_only',supportedProviders:['deepseek']}});
  expect(tree.root.findAllByProps({accessibilityRole:'radio'})).toHaveLength(0);
  const text=textOf(tree.root);
  expect(text).not.toContain('百炼');
  expect(text).not.toContain('切换至');
  expect(text).not.toContain('两边');
  expect(tree.root.findAllByType(TextInput)).toHaveLength(1);
  expect(tree.root.findByType(TextInput).props.value).toBe('draft-deepseek-key');
  await act(async()=>button('保存配置').props.onPress());
  await act(async()=>button('测试模型连接').props.onPress());
  expect(p.onSave).toHaveBeenCalledTimes(1);
  expect(p.onTest).toHaveBeenCalledTimes(1);
});

test('DeepSeek-only mode never renders a stale Bailian selection or its key state',async()=>{
  await mount({configuration:{...configuration,providerMode:'deepseek_only',provider:'bailian',activeProvider:'bailian',profiles:{bailian:{apiKeyConfigured:false}}}});
  expect(textOf(tree.root)).toContain('当前使用：DeepSeek');
  expect(textOf(tree.root)).not.toContain('百炼');
  expect(button('保存配置').props.disabled).toBeFalsy();
});
