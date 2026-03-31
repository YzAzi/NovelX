from .conflict_detector import ConflictDetector
from .notifier import EventNotifier
from .style_curation import StyleCurationService
from .style_knowledge import StyleKnowledgeManager
from .sync_strategy import DEFAULT_SYNC_CONFIG, SyncQueue, build_default_sync_manager
from .version_manager import VersionManager
from .websocket_manager import ConnectionManager

index_sync_manager = build_default_sync_manager()
sync_queue = SyncQueue(DEFAULT_SYNC_CONFIG, index_sync_manager=index_sync_manager)
conflict_detector = ConflictDetector()
style_knowledge_manager = StyleKnowledgeManager()
style_curation_service = StyleCurationService()
ws_manager = ConnectionManager()
notifier = EventNotifier(ws_manager)
version_manager = VersionManager()
