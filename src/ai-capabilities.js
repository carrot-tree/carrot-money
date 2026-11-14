'use strict';
// This catalog describes callable tools, not every feature of the plugin.
const supported=[
 {label:'把多目标要求拆成任务清单，逐项处理、确认和继续',tools:['plan_tasks']},
 {label:'查询账户资料、按账户筛选；查询周期与分期计划及待处理账单',tools:['accounts','plans']},
 {label:'回查当前会话的历史提议与确认记录',tools:['conversation_history']},
 {label:'查询和分析账单',tools:['stats','rows','duplicates','anomalies','budget','fixed_costs']},
 {label:'分批复核分类，可保存进度并继续；预览修改分类、账户、金额、日期',tools:['categories','review_entries','category_candidates','propose_change']},
 {label:'预览新建分类和账户；账目移入回收站',tools:['create_category','create_account','delete_entries']},
 {label:'查询订阅；预览添加、修改、暂停和恢复订阅',tools:['subscriptions','create_subscription','update_subscription']},
 {label:'生成、续写和修改分析报告',tools:['write_report','read_report']}
];
const manual={
 goal_read:{label:'查询储蓄目标与进度（目标跨账本共用，尚未接入对话授权范围）',tab:'goals',route:'心愿储蓄'},
 account_balance:{label:'查询账户余额（当前对话未开放余额读取）',tab:'accounts',route:'资产账户'},
 plan_settle:{label:'确认周期账单入账或跳过本期',tab:'plans',route:'周期与分期'},
 history_read:{label:'查询回收站或已生成报告列表',tab:'data',route:'数据与备份'},
 budget_write:{label:'设置或修改预算',tab:'budgets',route:'预算计划'},
 goal_write:{label:'新建、修改储蓄目标或存入金额',tab:'goals',route:'心愿储蓄'},
 entry_create:{label:'新增账目或导入账单',tab:'entries',route:'账单流水'},
 import_bill:{label:'导入或处理待入账账单',tab:'ai',route:'账单导入'},
 installment_write:{label:'新建或修改分期计划',tab:'plans',route:'周期与分期'},
 recurring_write:{label:'管理收入、转账计划或删除周期计划',tab:'plans',route:'周期与分期'},
 account_write:{label:'修改账户信息、余额或对账',tab:'accounts',route:'资产账户'},
 category_manage:{label:'重命名、删除、合并分类或管理账本',tab:'manage',route:'账本与分类'},
 refund_link:{label:'关联退款、报销或确认导入草稿入账',tab:'ai',route:'账单导入'},
 restore_data:{label:'恢复备份或清空数据',tab:'data',route:'数据与备份'},
 settings_write:{label:'修改插件、模型或外观设置',tab:'settings',route:'设置中心'},
 merchant_subscription:{label:'办理商家的实际退订或更改扣款',route:'商家 App 或支付平台'},
 bank_connection:{label:'自动连接银行、支付平台获取账单',route:'支付平台导出账单后，在「账单导入」导入'},
 other:{label:'这项操作',route:'请说明要处理的对象和具体动作，或打开设置中心查看功能入口',tab:'settings'}
};
function catalog(writeAccess=true){return {supported:supported.filter(x=>writeAccess||!x.tools.some(t=>['plan_tasks','propose_change','create_category','create_account','delete_entries','subscriptions','plans'].includes(t))),manual,confirmation:'账本修改须先预览，再由用户确认；订阅只是本地续费计划，不办理商家退订。'};}
function result(code='other'){if(!manual[code]||code==='other')return {ok:false,intent:'agent',status:'unsupported',unsupported:'other',message:'当前没有与这项请求对应的操作工具，本次未执行。请说明要处理的对象和具体动作，我会核对可用能力；也可到设置中心查看功能入口。',manualAction:{tab:'settings',label:'打开设置中心'}};const x=manual[code];return {ok:false,intent:'agent',status:'unsupported',unsupported:manual[code]?code:'other',message:`目前 AI 对话还不能${x.label==='这项操作'?'执行这项操作':x.label}。本次没有执行这项操作。\n\n请前往「${x.route}」办理。`,manualAction:x.tab?{tab:x.tab,label:'打开'+x.route}:undefined};}
function infer(name){if(/^(?:get|list|read|query|search|show|check)_/.test(name)){if(/goal|saving/.test(name))return 'goal_read';if(/balance/.test(name))return 'account_balance';}if(/post_due|settle|skip/.test(name))return 'plan_settle';if(/budget/.test(name))return 'budget_write';if(/goal|saving/.test(name))return 'goal_write';if(/installment/.test(name))return 'installment_write';if(/import/.test(name))return 'import_bill';if(/refund|reimburse/.test(name))return 'refund_link';if(/account|balance|reconcile/.test(name))return 'account_write';if(/category|book/.test(name))return 'category_manage';if(/restore|backup|reset/.test(name))return 'restore_data';if(/setting|theme/.test(name))return 'settings_write';if(/cancel_subscription|merchant/.test(name))return 'merchant_subscription';if(/subscription|rule|recurring/.test(name))return 'recurring_write';if(/bank|sync/.test(name))return 'bank_connection';if(/entry|entries|transaction/.test(name))return 'entry_create';return 'other';}
module.exports={supported,manual,catalog,result,infer};
