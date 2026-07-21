import { useState } from "react";
import { Lock, ArrowLeft, ExternalLink } from "lucide-react";
import botLogo from "@/assets/ai-assistant-logo.png";
import { Button } from "@/components/ui/button";
import { useAssistantCards } from "@/hooks/use-assistant-cards";
import type { AssistantCard } from "@/lib/assistant-cards-api";

interface AssistantEmptyStateProps {
  onSendMessage: (text: string) => void;
}

function CardSkeleton() {
  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900 p-4 animate-pulse">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg bg-stone-200 dark:bg-stone-700 shrink-0" />
        <div className="h-4 w-28 rounded bg-stone-200 dark:bg-stone-700" />
      </div>
      <div className="h-3 w-full rounded bg-stone-200 dark:bg-stone-700 mb-1.5" />
      <div className="h-3 w-3/4 rounded bg-stone-200 dark:bg-stone-700" />
    </div>
  );
}

function GroupSkeletons() {
  return (
    <div className="w-full max-w-2xl space-y-6">
      {[0, 1, 2].map((g) => (
        <div key={g}>
          <div className="h-3 w-24 rounded bg-stone-200 dark:bg-stone-700 mb-3 animate-pulse" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {[0, 1, 2, 3].map((c) => (
              <CardSkeleton key={c} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface UpgradeModalProps {
  card: AssistantCard;
  onClose: () => void;
}

function UpgradeModal({ card, onClose }: UpgradeModalProps) {
  const productName = card.upgradeProduct?.name ?? "an upgrade";
  const priceDisplay = card.upgradeProduct?.priceDisplay;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-sm rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-6 shadow-2xl"
        style={{ fontFamily: "'Roboto', sans-serif" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-stone-100 dark:bg-stone-800 flex items-center justify-center shrink-0 text-xl">
            {card.icon}
          </div>
          <div>
            <h3 className="font-semibold text-stone-900 dark:text-stone-100 text-base leading-tight">
              {card.title} requires {productName}
            </h3>
          </div>
        </div>

        <p className="text-[14px] text-stone-600 dark:text-stone-400 leading-relaxed mb-4">
          {card.description} Unlock this category and more with{" "}
          <span className="font-medium text-stone-900 dark:text-stone-100">
            {productName}
          </span>
          .
        </p>

        {priceDisplay && (
          <p className="text-2xl font-bold text-stone-900 dark:text-stone-100 mb-4">
            {priceDisplay}
          </p>
        )}

        <div className="flex gap-2">
          <Button
            className="flex-1 bg-stone-900 hover:bg-stone-800 text-stone-50 dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900"
            disabled
            data-testid={`button-upgrade-${card.id}`}
          >
            Upgrade
            <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
          </Button>
          <Button
            variant="outline"
            onClick={onClose}
            className="border-stone-200 dark:border-stone-800"
            data-testid="button-upgrade-modal-close"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

interface QuestionListProps {
  card: AssistantCard;
  onBack: () => void;
  onSelectQuestion: (text: string) => void;
}

function QuestionList({ card, onBack, onSelectQuestion }: QuestionListProps) {
  return (
    <div
      className="w-full max-w-2xl"
      style={{ animation: "fadeSlideIn 180ms ease-out", fontFamily: "'Roboto', sans-serif" }}
    >
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 mb-5 transition-colors group"
        data-testid="button-back-to-cards"
      >
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
        Back
      </button>

      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-9 h-9 rounded-xl bg-stone-100 dark:bg-stone-800 flex items-center justify-center shrink-0 text-lg">
          {card.icon}
        </div>
        <div>
          <h4 className="font-semibold text-stone-900 dark:text-stone-100 leading-tight">{card.title}</h4>
          <p className="text-[13px] text-stone-500">{card.description}</p>
        </div>
      </div>

      <div className="space-y-2">
        {card.questions.map((q) => (
          <button
            key={q.id}
            onClick={() => onSelectQuestion(q.body)}
            className="w-full text-left px-4 py-3 rounded-xl border border-[#D6DEEC] dark:border-stone-800 bg-white dark:bg-stone-900 hover:border-[#B9C7E2] dark:hover:border-stone-700 hover:bg-[#F6F8FC] dark:hover:bg-stone-800/60 hover:shadow-sm text-[14px] text-stone-700 dark:text-stone-200 transition-all"
            data-testid={`button-question-${q.id}`}
          >
            {q.body}
          </button>
        ))}
        {card.questions.length === 0 && (
          <p className="text-sm text-stone-400 text-center py-4">No questions available yet.</p>
        )}
      </div>
    </div>
  );
}

interface CardTileProps {
  card: AssistantCard;
  onClickEntitled: (card: AssistantCard) => void;
  onClickLocked: (card: AssistantCard) => void;
}

function CardTile({ card, onClickEntitled, onClickLocked }: CardTileProps) {
  const isLocked = card.locked;

  return (
    <button
      onClick={() => (isLocked ? onClickLocked(card) : onClickEntitled(card))}
      className={`relative text-left rounded-xl border p-4 transition-all group ${
        isLocked
          ? "border-[#D6DEEC] dark:border-stone-800 bg-[#F6F8FC]/60 dark:bg-stone-900/40 opacity-60 cursor-pointer hover:opacity-75"
          : "border-[#D6DEEC] dark:border-stone-800 bg-white dark:bg-stone-900 hover:border-[#B9C7E2] dark:hover:border-stone-700 hover:bg-[#F6F8FC] dark:hover:bg-stone-800/60 hover:shadow-sm"
      }`}
      style={{ fontFamily: "'Roboto', sans-serif" }}
      data-testid={`button-card-${card.id}`}
    >
      <div className="flex items-start gap-2 mb-2">
        <span className="text-xl leading-none shrink-0 mt-0.5">{card.icon}</span>
        <span className="font-medium text-stone-900 dark:text-stone-100 text-[13px] leading-tight flex-1">
          {card.title}
        </span>
        {isLocked && (
          <Lock className="w-3.5 h-3.5 text-stone-400 shrink-0 mt-0.5" />
        )}
      </div>
      <p className="text-[12px] text-stone-500 dark:text-stone-400 leading-relaxed line-clamp-2">
        {card.description}
      </p>
      {isLocked && (
        <p className="mt-2 text-[11px] font-medium text-stone-400 dark:text-stone-500">
          Upgrade to unlock
        </p>
      )}
    </button>
  );
}

const TRANSITION_MS = 160;

export function AssistantEmptyState({ onSendMessage }: AssistantEmptyStateProps) {
  const { data: groups, isLoading, isError } = useAssistantCards();
  const [selectedCard, setSelectedCard] = useState<AssistantCard | null>(null);
  const [upgradeCard, setUpgradeCard] = useState<AssistantCard | null>(null);
  const [view, setView] = useState<"cards" | "questions">("cards");
  const [exiting, setExiting] = useState(false);

  const transitionTo = (nextView: "cards" | "questions", card?: AssistantCard) => {
    setExiting(true);
    setTimeout(() => {
      if (card) setSelectedCard(card);
      else setSelectedCard(null);
      setView(nextView);
      setExiting(false);
    }, TRANSITION_MS);
  };

  const handleEntitled = (card: AssistantCard) => {
    transitionTo("questions", card);
  };

  const handleLocked = (card: AssistantCard) => {
    setUpgradeCard(card);
  };

  const handleBack = () => {
    transitionTo("cards");
  };

  const handleSelectQuestion = (text: string) => {
    onSendMessage(text);
  };

  return (
    <>
      {upgradeCard && (
        <UpgradeModal card={upgradeCard} onClose={() => setUpgradeCard(null)} />
      )}

      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <div className="w-16 h-16 flex items-center justify-center mb-5">
          <img
            src={botLogo}
            alt=""
            className="w-full h-full object-contain scale-[1.15]"
            draggable={false}
          />
        </div>
        <h3
          className="text-[26px] font-semibold text-stone-900 dark:text-stone-100 mb-3 tracking-tight"
          style={{ fontFamily: "'Source Serif 4', 'Lora', Georgia, serif" }}
        >
          How can I help you today?
        </h3>
        <p
          className="text-[15px] text-stone-500 max-w-md mb-10 leading-relaxed"
          style={{ fontFamily: "'Roboto', sans-serif" }}
        >
          Ask anything about your mentorship, tools, campaigns, or strategies. I'm trained on BTS coaching
          sessions, Q&amp;A articles, and your complete tool documentation.
        </p>

        {isLoading && <GroupSkeletons />}

        {isError && (
          <p
            className="text-[13px] text-stone-400 dark:text-stone-500 italic"
            style={{ fontFamily: "'Roboto', sans-serif" }}
          >
            Suggestions unavailable — type below to start a chat
          </p>
        )}

        {!isLoading && !isError && groups && (
          <div
            style={{
              animation: exiting
                ? `fadeSlideOut ${TRANSITION_MS}ms ease-in forwards`
                : "fadeSlideIn 180ms ease-out",
            }}
            className="w-full max-w-2xl"
          >
            {view === "questions" && selectedCard ? (
              <QuestionList
                card={selectedCard}
                onBack={handleBack}
                onSelectQuestion={handleSelectQuestion}
              />
            ) : (
              <div className="space-y-8">
                {groups.map((grp) => (
                  <div key={grp.id}>
                    <p
                      className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-3 text-left"
                      style={{ fontFamily: "'Roboto', sans-serif" }}
                    >
                      {grp.name}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                      {grp.cards.map((card) => (
                        <CardTile
                          key={card.id}
                          card={card}
                          onClickEntitled={handleEntitled}
                          onClickLocked={handleLocked}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        @keyframes fadeSlideOut {
          from { opacity: 1; transform: translateY(0);   }
          to   { opacity: 0; transform: translateY(-6px); }
        }
      `}</style>
    </>
  );
}
