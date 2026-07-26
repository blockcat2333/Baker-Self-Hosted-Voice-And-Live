#include "ui/ServerTreeModel.h"

#include <QApplication>
#include <QBrush>
#include <QColor>
#include <QFont>
#include <QSet>
#include <QStyle>

#include <algorithm>

namespace baker::lite::ui {
namespace {

int kindRank(const TreeItemKind kind) {
  switch (kind) {
  case TreeItemKind::Server:
    return 0;
  case TreeItemKind::Guild:
    return 1;
  case TreeItemKind::TextChannel:
    return 2;
  case TreeItemKind::VoiceChannel:
    return 3;
  case TreeItemKind::User:
    return 4;
  }
  return 5;
}

} // namespace

ServerTreeModel::ServerTreeModel(QObject *parent)
    : QAbstractItemModel(parent), root_(std::make_unique<Node>()) {}

ServerTreeModel::~ServerTreeModel() = default;

QModelIndex ServerTreeModel::index(const int row, const int column,
                                   const QModelIndex &parentIndex) const {
  if (row < 0 || column < 0 || column >= columnCount(parentIndex)) {
    return {};
  }

  Node *parentNode = nodeForIndex(parentIndex);
  if (parentNode == nullptr ||
      static_cast<std::size_t>(row) >= parentNode->children.size()) {
    return {};
  }

  return createIndex(row, column, parentNode->children.at(row).get());
}

QModelIndex ServerTreeModel::parent(const QModelIndex &child) const {
  if (!child.isValid()) {
    return {};
  }

  const Node *childNode = nodeForIndex(child);
  const Node *parentNode = childNode != nullptr ? childNode->parent : nullptr;
  if (parentNode == nullptr || parentNode == root_.get()) {
    return {};
  }

  return createIndex(rowOfNode(parentNode), 0, const_cast<Node *>(parentNode));
}

int ServerTreeModel::rowCount(const QModelIndex &parentIndex) const {
  if (parentIndex.column() > 0) {
    return 0;
  }
  const Node *parentNode = nodeForIndex(parentIndex);
  return parentNode != nullptr ? static_cast<int>(parentNode->children.size())
                               : 0;
}

int ServerTreeModel::columnCount(const QModelIndex &) const { return 1; }

QVariant ServerTreeModel::data(const QModelIndex &modelIndex,
                               const int role) const {
  if (!modelIndex.isValid()) {
    return {};
  }

  const Node *node = nodeForIndex(modelIndex);
  if (node == nullptr) {
    return {};
  }

  switch (role) {
  case Qt::DisplayRole:
    return decoratedName(*node);
  case Qt::DecorationRole:
    return iconForNode(*node);
  case Qt::ToolTipRole: {
    QString tooltip = node->item.subtitle;
    if (node->item.kind == TreeItemKind::User &&
        node->item.networkQuality >= 0) {
      const int quality = std::clamp(node->item.networkQuality, 0, 3);
      const QString qualityText =
          quality == 3
              ? tr("Excellent")
              : (quality == 2
                     ? tr("Good")
                     : (quality == 1 ? tr("Poor") : tr("Connection lost")));
      if (!tooltip.isEmpty()) {
        tooltip += QLatin1Char('\n');
      }
      tooltip += tr("Network quality: %1").arg(qualityText);
    }
    return tooltip;
  }
  case Qt::FontRole: {
    QFont font;
    font.setBold(node->item.kind == TreeItemKind::Server ||
                 node->item.kind == TreeItemKind::Guild || node->item.speaking);
    return font;
  }
  case Qt::ForegroundRole:
    if (node->item.kind == TreeItemKind::User && node->item.streaming) {
      return QBrush(QColor(QStringLiteral("#ef626c")));
    }
    if (node->item.kind == TreeItemKind::User && !node->item.online) {
      return QBrush(QColor(QStringLiteral("#78828f")));
    }
    if (node->item.speaking) {
      return QBrush(QColor(QStringLiteral("#58d18a")));
    }
    return {};
  case ItemIdRole:
    return node->item.id;
  case ParentIdRole:
    return node->item.parentId;
  case KindRole:
    return QVariant::fromValue(node->item.kind);
  case OnlineRole:
    return node->item.online;
  case MutedRole:
    return node->item.muted;
  case SpeakingRole:
    return node->item.speaking;
  case SharingMusicRole:
    return node->item.sharingMusic;
  case StreamingRole:
    return node->item.streaming;
  case NetworkQualityRole:
    return node->item.networkQuality;
  case UnreadCountRole:
    return node->item.unreadCount;
  default:
    return {};
  }
}

Qt::ItemFlags ServerTreeModel::flags(const QModelIndex &modelIndex) const {
  if (!modelIndex.isValid()) {
    return Qt::NoItemFlags;
  }
  return Qt::ItemIsEnabled | Qt::ItemIsSelectable;
}

QHash<int, QByteArray> ServerTreeModel::roleNames() const {
  return {
      {ItemIdRole, "itemId"},
      {ParentIdRole, "parentId"},
      {KindRole, "kind"},
      {OnlineRole, "online"},
      {MutedRole, "muted"},
      {SpeakingRole, "speaking"},
      {SharingMusicRole, "sharingMusic"},
      {StreamingRole, "streaming"},
      {NetworkQualityRole, "networkQuality"},
      {UnreadCountRole, "unreadCount"},
  };
}

void ServerTreeModel::setItems(const QList<ServerTreeItem> &items) {
  beginResetModel();
  rebuild(items);
  endResetModel();
}

void ServerTreeModel::upsertItem(const ServerTreeItem &item) {
  QList<ServerTreeItem> items;
  items.reserve(nodesById_.size() + 1);
  bool replaced = false;
  for (auto iterator = nodesById_.cbegin(); iterator != nodesById_.cend();
       ++iterator) {
    if (iterator.key() == item.id) {
      items.push_back(item);
      replaced = true;
    } else {
      items.push_back(iterator.value()->item);
    }
  }
  if (!replaced) {
    items.push_back(item);
  }
  setItems(items);
}

void ServerTreeModel::removeItem(const QString &itemId) {
  if (!nodesById_.contains(itemId)) {
    return;
  }

  QList<ServerTreeItem> retained;
  retained.reserve(nodesById_.size());
  QSet<QString> removedIds{itemId};
  bool changed = true;
  while (changed) {
    changed = false;
    for (auto iterator = nodesById_.cbegin(); iterator != nodesById_.cend();
         ++iterator) {
      if (!removedIds.contains(iterator.key()) &&
          removedIds.contains(iterator.value()->item.parentId)) {
        removedIds.insert(iterator.key());
        changed = true;
      }
    }
  }
  for (auto iterator = nodesById_.cbegin(); iterator != nodesById_.cend();
       ++iterator) {
    if (!removedIds.contains(iterator.key())) {
      retained.push_back(iterator.value()->item);
    }
  }
  setItems(retained);
}

void ServerTreeModel::clear() { setItems({}); }

ServerTreeItem
ServerTreeModel::itemForIndex(const QModelIndex &modelIndex) const {
  const Node *node = nodeForIndex(modelIndex);
  return node != nullptr ? node->item : ServerTreeItem{};
}

QModelIndex ServerTreeModel::indexForId(const QString &itemId) const {
  const Node *node = nodesById_.value(itemId, nullptr);
  if (node == nullptr || node == root_.get()) {
    return {};
  }
  return createIndex(rowOfNode(node), 0, const_cast<Node *>(node));
}

ServerTreeModel::Node *
ServerTreeModel::nodeForIndex(const QModelIndex &modelIndex) const {
  return modelIndex.isValid()
             ? static_cast<Node *>(modelIndex.internalPointer())
             : root_.get();
}

int ServerTreeModel::rowOfNode(const Node *node) const {
  if (node == nullptr || node->parent == nullptr) {
    return 0;
  }
  const auto &siblings = node->parent->children;
  for (std::size_t row = 0; row < siblings.size(); ++row) {
    if (siblings.at(row).get() == node) {
      return static_cast<int>(row);
    }
  }
  return 0;
}

QIcon ServerTreeModel::iconForNode(const Node &node) const {
  QString resource;
  switch (node.item.kind) {
  case TreeItemKind::Server:
    resource = QStringLiteral(":/icons/server.svg");
    break;
  case TreeItemKind::Guild:
    resource = QStringLiteral(":/icons/guild.svg");
    break;
  case TreeItemKind::TextChannel:
    resource = QStringLiteral(":/icons/chat.svg");
    break;
  case TreeItemKind::VoiceChannel:
    resource = QStringLiteral(":/icons/voice.svg");
    break;
  case TreeItemKind::User:
    if (node.item.speaking) {
      resource = QStringLiteral(":/icons/speaking.svg");
    } else if (node.item.muted) {
      resource = QStringLiteral(":/icons/muted.svg");
    } else {
      resource = QStringLiteral(":/icons/user.svg");
    }
    break;
  }

  QIcon icon(resource);
  if (!icon.isNull()) {
    return icon;
  }

  QStyle *style = QApplication::style();
  switch (node.item.kind) {
  case TreeItemKind::Server:
  case TreeItemKind::Guild:
    return style->standardIcon(QStyle::SP_DriveNetIcon);
  case TreeItemKind::TextChannel:
    return style->standardIcon(QStyle::SP_FileDialogDetailedView);
  case TreeItemKind::VoiceChannel:
    return style->standardIcon(QStyle::SP_MediaVolume);
  case TreeItemKind::User:
    return style->standardIcon(QStyle::SP_ComputerIcon);
  }
  return {};
}

QString ServerTreeModel::decoratedName(const Node &node) const {
  QString name = node.item.name;
  if (node.item.kind == TreeItemKind::User) {
    if (node.item.networkQuality == 0) {
      name += tr(" (connection lost)");
    } else if (node.item.networkQuality == 1) {
      name += tr(" (network issue)");
    }
  }
  if (node.item.unreadCount > 0) {
    name += QStringLiteral("  (%1)").arg(node.item.unreadCount);
  }
  if (node.item.sharingMusic) {
    name += QStringLiteral("  ♪");
  }
  if (node.item.streaming) {
    name += QStringLiteral("  LIVE");
  }
  return name;
}

void ServerTreeModel::rebuild(const QList<ServerTreeItem> &items) {
  root_ = std::make_unique<Node>();
  nodesById_.clear();

  QHash<QString, ServerTreeItem> remaining;
  remaining.reserve(items.size());
  for (const auto &item : items) {
    if (!item.id.isEmpty()) {
      remaining.insert(item.id, item);
    }
  }

  bool madeProgress = true;
  while (!remaining.isEmpty() && madeProgress) {
    madeProgress = false;
    for (auto iterator = remaining.begin(); iterator != remaining.end();) {
      const bool isTopLevel = iterator->parentId.isEmpty() ||
                              !remaining.contains(iterator->parentId);
      Node *parentNode = iterator->parentId.isEmpty()
                             ? root_.get()
                             : nodesById_.value(iterator->parentId, nullptr);
      if (parentNode == nullptr && !isTopLevel) {
        ++iterator;
        continue;
      }
      if (parentNode == nullptr) {
        parentNode = root_.get();
      }

      auto node = std::make_unique<Node>();
      node->item = iterator.value();
      node->parent = parentNode;
      Node *rawNode = node.get();
      parentNode->children.push_back(std::move(node));
      nodesById_.insert(rawNode->item.id, rawNode);
      iterator = remaining.erase(iterator);
      madeProgress = true;
    }
  }

  for (auto iterator = remaining.cbegin(); iterator != remaining.cend();
       ++iterator) {
    auto node = std::make_unique<Node>();
    node->item = iterator.value();
    node->parent = root_.get();
    Node *rawNode = node.get();
    root_->children.push_back(std::move(node));
    nodesById_.insert(rawNode->item.id, rawNode);
  }

  const auto sortChildren = [&](auto &&self, Node *node) -> void {
    std::stable_sort(node->children.begin(), node->children.end(),
                     [](const auto &left, const auto &right) {
                       const int leftRank = kindRank(left->item.kind);
                       const int rightRank = kindRank(right->item.kind);
                       if (leftRank != rightRank) {
                         return leftRank < rightRank;
                       }
                       return left->item.name.localeAwareCompare(
                                  right->item.name) < 0;
                     });
    for (const auto &child : node->children) {
      self(self, child.get());
    }
  };
  sortChildren(sortChildren, root_.get());
}

void ServerTreeModel::indexNode(Node *node) {
  if (node == nullptr) {
    return;
  }
  if (!node->item.id.isEmpty()) {
    nodesById_.insert(node->item.id, node);
  }
  for (const auto &child : node->children) {
    indexNode(child.get());
  }
}

} // namespace baker::lite::ui
