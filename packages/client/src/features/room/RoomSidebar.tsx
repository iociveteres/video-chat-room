import { MAX_PARTICIPANTS } from '@vcr/shared';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useAppState } from '../../state/AppStateProvider';
import { selectParticipants } from '../../state/selectors';
import { ChatPanel } from '../chat/ChatPanel';
import { ParticipantList } from './ParticipantList';

type SidebarTab = 'chat' | 'participants';

const TAB_ORDER: SidebarTab[] = ['chat', 'participants'];

/**
 * Правая панель комнаты во всю высоту экрана: вкладки «Чат» и «Участники».
 * Неактивная вкладка скрывается, а не размонтируется: черновик сообщения сохраняется.
 */
export function RoomSidebar() {
  const state = useAppState();
  const participants = selectParticipants(state);
  const [activeTab, setActiveTab] = useState<SidebarTab>('chat');
  const baseId = useId();
  const tabsRef = useRef<Partial<Record<SidebarTab, HTMLButtonElement | null>>>({});

  const tabId = (tab: SidebarTab) => `${baseId}-tab-${tab}`;
  const panelId = (tab: SidebarTab) => `${baseId}-panel-${tab}`;
  const labels: Record<SidebarTab, string> = {
    chat: 'Чат',
    // Счётчик в названии вкладки виден, даже когда открыт чат.
    participants: `Участники (${participants.length}/${MAX_PARTICIPANTS})`,
  };

  const selectTab = (tab: SidebarTab) => {
    setActiveTab(tab);
    tabsRef.current[tab]?.focus();
  };

  // Клавиатура по паттерну WAI-ARIA Tabs: стрелки, Home и End переключают вкладку сразу.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TAB_ORDER.indexOf(activeTab);
    const last = TAB_ORDER.length - 1;
    const next: Partial<Record<string, number>> = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    const nextIndex = next[event.key];
    if (nextIndex === undefined) return;
    event.preventDefault();
    selectTab(TAB_ORDER[nextIndex]!);
  };

  return (
    <aside className="room__sidebar">
      <div className="sidebar-tabs" role="tablist" onKeyDown={handleKeyDown}>
        {TAB_ORDER.map((tab) => (
          <button
            key={tab}
            ref={(element) => {
              tabsRef.current[tab] = element;
            }}
            type="button"
            role="tab"
            id={tabId(tab)}
            className="sidebar-tabs__tab"
            aria-selected={tab === activeTab}
            aria-controls={panelId(tab)}
            // Roving tabindex: Tab попадает только на активную вкладку.
            tabIndex={tab === activeTab ? 0 : -1}
            onClick={() => setActiveTab(tab)}
          >
            {labels[tab]}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={panelId('chat')}
        className="room__panel"
        aria-labelledby={tabId('chat')}
        hidden={activeTab !== 'chat'}
      >
        <ChatPanel active={activeTab === 'chat'} />
      </div>
      <div
        role="tabpanel"
        id={panelId('participants')}
        className="room__panel"
        aria-labelledby={tabId('participants')}
        hidden={activeTab !== 'participants'}
      >
        <ParticipantList participants={participants} selfId={state.selfId} />
      </div>
    </aside>
  );
}
