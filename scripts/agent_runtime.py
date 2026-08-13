#!/usr/bin/env python3
"""
AlphaMind Agent Graph Runtime
编排多 Agent 研究流水线: Intent → DSL → Data → Execute → Risk → Evidence → Critic → Report
支持检查点/恢复/超时/重试
"""
import json, sys, os, time, traceback
import runtime_compat  # noqa: F401  # normalize Windows stdio to UTF-8
from datetime import datetime
from pathlib import Path
from enum import Enum

DATA_DIR = Path(__file__).parent.parent / 'public' / 'data'
CHECKPOINT_DIR = Path(__file__).parent.parent / '.alphamind-agent-runs'
CHECKPOINT_DIR.mkdir(exist_ok=True)

class NodeStatus(Enum):
    PENDING = 'pending'
    RUNNING = 'running'
    COMPLETED = 'completed'
    FAILED = 'failed'
    SKIPPED = 'skipped'
    AWAITING_APPROVAL = 'awaiting_approval'

AGENT_GRAPH = [
    {'id': 'intent', 'name': '意图识别', 'description': '解析用户意图与专业水平', 'deps': []},
    {'id': 'dsl', 'name': 'DSL 生成', 'description': '生成结构化策略条件', 'deps': ['intent']},
    {'id': 'data', 'name': '数据检查', 'description': '确认数据覆盖、截止日期、版本', 'deps': ['dsl']},
    {'id': 'execute', 'name': '策略执行', 'description': '选股/因子计算', 'deps': ['data']},
    {'id': 'risk', 'name': '风险检查', 'description': '暴露/容量/流动性评估', 'deps': ['execute']},
    {'id': 'evidence', 'name': '证据检索', 'description': '财报/公告/研报证据', 'deps': ['execute']},
    {'id': 'critic', 'name': '反方审查', 'description': '寻找反例/前视/过拟合', 'deps': ['risk', 'evidence']},
    {'id': 'approve', 'name': '人工审批', 'description': '等待用户确认', 'deps': ['critic']},
    {'id': 'report', 'name': '报告生成', 'description': '基于结构化结果生成报告', 'deps': ['approve']},
]

def run_node(graph_run, node_id, inputs):
    """执行单个节点（模拟）"""
    node = next((n for n in AGENT_GRAPH if n['id'] == node_id), None)
    if not node:
        return {'status': 'failed', 'error': f'Unknown node: {node_id}'}
    
    # 模拟执行延迟
    time.sleep(0.1)
    
    outputs = {
        'intent': {'task': '选股分析', 'level': 'professional'},
        'dsl': {'schema_version': 1, 'filters': [{'field': 'pe', 'operator': 'less_than', 'value': 25}]},
        'data': {'coverage': '5533 stocks', 'latest_date': '2026-08-08', 'quality_passed': True},
        'execute': {'matched': 342, 'top10': ['600519', '000858', '000568']},
        'risk': {'exposure': 'medium', 'warnings': [], 'capacity_ok': True},
        'evidence': {'sources': 5, 'key_findings': ['Q2营收超预期', '北向资金持续流入']},
        'critic': {'contradictions': [], 'overfit_risk': 'low', 'verdict': 'pass'},
        'approve': {'status': 'awaiting', 'message': '请确认是否继续'},
        'report': {'format': 'markdown', 'length': 1200, 'generated': True},
    }
    
    return {
        'status': 'completed' if node_id != 'approve' else 'awaiting_approval',
        'output': outputs.get(node_id, {}),
        'duration_ms': 100,
    }

def execute_graph(task_id, params, run_id=None):
    """执行完整的 Agent Graph"""
    if run_id:
        # 从检查点恢复
        path = CHECKPOINT_DIR / f'{run_id}.json'
        if path.exists():
            with open(path, encoding='utf-8') as f:
                graph_run = json.load(f)
        else:
            return {'error': f'Run not found: {run_id}'}
    else:
        run_id = f'agent-{datetime.now().strftime("%Y%m%d-%H%M%S")}-{task_id[:6]}'
        graph_run = {
            'run_id': run_id,
            'task_id': task_id,
            'params': params,
            'status': 'running',
            'started_at': datetime.now().isoformat(),
            'nodes': {},
            'current_node': None,
        }
        for node in AGENT_GRAPH:
            graph_run['nodes'][node['id']] = {
                'id': node['id'], 'name': node['name'], 'status': 'pending',
                'input': None, 'output': None, 'error': None, 'duration_ms': None,
            }
    
    # 执行待处理的节点
    for node in AGENT_GRAPH:
        if graph_run['nodes'][node['id']]['status'] in ('completed', 'failed', 'skipped'):
            continue
        
        # 检查依赖
        deps_met = True
        for dep in node['deps']:
            dep_status = graph_run['nodes'].get(dep, {}).get('status')
            if dep_status != 'completed' and dep_status != 'skipped':
                deps_met = False
                break
        
        if not deps_met:
            continue
        
        # 收集输入
        node_input = {}
        for dep in node['deps']:
            dep_output = graph_run['nodes'].get(dep, {}).get('output')
            if dep_output:
                node_input[dep] = dep_output
        
        # 执行节点
        graph_run['current_node'] = node['id']
        graph_run['nodes'][node['id']]['status'] = 'running'
        graph_run['nodes'][node['id']]['input'] = node_input
        graph_run['nodes'][node['id']]['started_at'] = datetime.now().isoformat()
        
        # 保存检查点
        save_checkpoint(run_id, graph_run)
        
        try:
            result = run_node(graph_run, node['id'], node_input)
            graph_run['nodes'][node['id']]['status'] = result['status']
            graph_run['nodes'][node['id']]['output'] = result.get('output')
            graph_run['nodes'][node['id']]['duration_ms'] = result.get('duration_ms')
            
            if result['status'] == 'awaiting_approval':
                graph_run['status'] = 'awaiting_approval'
                save_checkpoint(run_id, graph_run)
                return graph_run
            
            if result['status'] == 'failed':
                graph_run['nodes'][node['id']]['error'] = result.get('error')
                # 失败不阻塞，继续执行
        except Exception as e:
            graph_run['nodes'][node['id']]['status'] = 'failed'
            graph_run['nodes'][node['id']]['error'] = str(e)
    
    # 检查是否全部完成
    all_done = all(
        n['status'] in ('completed', 'skipped', 'failed', 'awaiting_approval')
        for n in graph_run['nodes'].values()
    )
    
    if all_done and graph_run['status'] != 'awaiting_approval':
        graph_run['status'] = 'completed'
        graph_run['completed_at'] = datetime.now().isoformat()
    
    graph_run['current_node'] = None
    save_checkpoint(run_id, graph_run)
    return graph_run

def save_checkpoint(run_id, graph_run):
    with open(CHECKPOINT_DIR / f'{run_id}.json', 'w', encoding='utf-8') as f:
        json.dump(graph_run, f, indent=2, ensure_ascii=False, default=str)

def approve_node(run_id):
    """用户审批节点"""
    path = CHECKPOINT_DIR / f'{run_id}.json'
    if not path.exists():
        return {'error': f'Run not found: {run_id}'}
    
    with open(path, encoding='utf-8') as f:
        graph_run = json.load(f)
    
    # 找到 awaiting_approval 的节点
    graph_run['nodes']['approve']['status'] = 'completed'
    graph_run['nodes']['approve']['output'] = {'approved': True, 'approved_at': datetime.now().isoformat()}
    graph_run['status'] = 'running'
    
    # 继续执行剩余节点
    return execute_graph(graph_run['task_id'], graph_run['params'], run_id)

def list_runs():
    runs = []
    for fp in sorted(CHECKPOINT_DIR.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            with open(fp, encoding='utf-8') as f:
                run = json.load(f)
            runs.append({
                'run_id': run['run_id'],
                'task_id': run.get('task_id', ''),
                'status': run['status'],
                'started_at': run.get('started_at'),
                'completed_at': run.get('completed_at'),
            })
        except:
            pass
    return runs[:20]

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['run', 'approve', 'list', 'get'])
    parser.add_argument('--task-id', default='default')
    parser.add_argument('--run-id', default='')
    parser.add_argument('--params', default='{}')
    
    args = parser.parse_args()
    
    if args.action == 'run':
        params = json.loads(args.params)
        result = execute_graph(args.task_id, params)
        print(json.dumps(result, indent=2, ensure_ascii=False, default=str))
    
    elif args.action == 'approve':
        if not args.run_id:
            print(json.dumps({'error': 'run-id required'}, ensure_ascii=False))
            sys.exit(1)
        result = approve_node(args.run_id)
        print(json.dumps(result, indent=2, ensure_ascii=False, default=str))
    
    elif args.action == 'list':
        runs = list_runs()
        print(json.dumps(runs, indent=2, ensure_ascii=False))
    
    elif args.action == 'get':
        path = CHECKPOINT_DIR / f'{args.run_id}.json'
        if path.exists():
            with open(path, encoding='utf-8') as f:
                print(f.read())
        else:
            print(json.dumps({'error': f'Run not found: {args.run_id}'}, ensure_ascii=False))
