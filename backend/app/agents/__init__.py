"""LangGraph agent layer.

The graph is an explicit, testable flowchart. Every node is `verb_noun`, single
responsibility, and returns a full updated state. Only `select_pill` may touch a model.
"""
