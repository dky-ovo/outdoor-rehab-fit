import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';

export default function AdminAiConfiguration({ configuration, onChange, onSave, onTest, busy, testResult, styles }) {
  const deepseekOnly = configuration.providerMode === 'deepseek_only';
  const provider = deepseekOnly ? 'deepseek' : configuration.provider || 'deepseek';
  const label = value => value === 'bailian' ? '阿里百炼' : 'DeepSeek';
  const bailian = configuration.profiles?.bailian;
  return <>
    <View style={styles.sectionHeader}><View><Text style={styles.sectionTitle}>AI 助手模型配置</Text>
      <Text style={styles.sectionHint}>{deepseekOnly ? '当前使用：DeepSeek。' : `当前使用：${label(configuration.activeProvider || provider)}。两边的配置、聊天历史及任务分别保存。`}</Text></View></View>
    <View style={[styles.panel, styles.facilityPanel]}>
      {!deepseekOnly && <><Text style={styles.fieldLabel}>选择聊天模型</Text>
      <View style={styles.roleRow}>{['deepseek', 'bailian'].map(value => <TouchableOpacity key={value} accessibilityRole="radio" accessibilityState={{ checked: provider === value, disabled: busy }} disabled={busy}
        style={[styles.roleButton, provider === value && styles.roleButtonActive]} onPress={() => onChange({ ...configuration, provider: value })}>
        <Text style={[styles.roleButtonText, provider === value && styles.roleButtonTextActive]}>{label(value)}</Text></TouchableOpacity>)}</View></>}
      {provider === 'deepseek' ? <>
        <Text style={styles.fieldHint}>使用现有 DeepSeek 模型、应用提示词和 FAQ 回答规则。</Text>
        <Text style={styles.fieldLabel}>DeepSeek 模型</Text>
        <View style={styles.roleRow}>{[['deepseek-v4-flash', 'DeepSeek V4 Flash'], ['deepseek-v4-pro', 'DeepSeek V4 Pro']].map(([model, name]) => <TouchableOpacity key={model} disabled={busy} style={[styles.roleButton, configuration.model === model && styles.roleButtonActive]} onPress={() => onChange({ ...configuration, model })}><Text style={[styles.roleButtonText, configuration.model === model && styles.roleButtonTextActive]}>{name}</Text></TouchableOpacity>)}</View>
        <Text style={styles.fieldLabel}>DeepSeek API Key</Text><TextInput accessibilityLabel="DeepSeek API Key" style={styles.input} editable={!busy} value={configuration.apiKey || ''} onChangeText={apiKey => onChange({ ...configuration, apiKey })} autoCapitalize="none" secureTextEntry placeholder={configuration.apiKeyConfigured ? '已保存；留空表示不更换' : '输入 DeepSeek API Key'} />
      </> : <>
        <Text style={styles.fieldLabel}>已训练的百炼模型</Text>
        <Text style={styles.dataLine}>{bailian?.model || '服务器尚未配置'}</Text>
        <Text style={styles.fieldHint}>{bailian?.baseUrl || ''}</Text>
        <Text style={styles.fieldHint}>应用提示词：关闭 · FAQ：关闭。直接发送当前百炼对话的提问及历史，展示模型原始回答；失败时不会切到 DeepSeek。</Text>
        <Text style={styles.fieldHint}>密钥状态：{bailian?.apiKeyConfigured ? '服务器已配置' : '未配置；请在服务器填写 DASHSCOPE_API_KEY 或对应密钥文件'}</Text>
      </>}
      <TouchableOpacity style={styles.primaryButton} onPress={onSave} disabled={busy || (provider === 'bailian' && !bailian?.apiKeyConfigured)}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{deepseekOnly ? '保存配置' : `保存并切换至${label(provider)}`}</Text>}</TouchableOpacity>
      <TouchableOpacity style={[styles.exportButton, { marginTop: 10 }]} onPress={onTest} disabled={busy}><Text style={styles.exportButtonText}>{deepseekOnly ? '测试模型连接' : '测试所选模型连接'}</Text></TouchableOpacity>
      {!deepseekOnly && <Text style={styles.fieldHint}>测试连接不会更改当前模型。手机需要先接收本次更新，再启用百炼。</Text>}
      {!!testResult && <Text style={[styles.fieldHint, { color: '#177245', marginTop: 10 }]}>{testResult}</Text>}
    </View>
  </>;
}
