#pragma once

#include "ui/UiTypes.h"

#include <QAbstractItemModel>
#include <QHash>
#include <QIcon>
#include <QList>

#include <memory>
#include <vector>

namespace baker::lite::ui {

class ServerTreeModel final : public QAbstractItemModel {
    Q_OBJECT

public:
    enum Role {
        ItemIdRole = Qt::UserRole + 1,
        ParentIdRole,
        KindRole,
        OnlineRole,
        MutedRole,
        SpeakingRole,
        SharingMusicRole,
        StreamingRole,
        NetworkQualityRole,
        UnreadCountRole,
    };

    explicit ServerTreeModel(QObject* parent = nullptr);
    ~ServerTreeModel() override;

    [[nodiscard]] QModelIndex index(
        int row,
        int column,
        const QModelIndex& parent = QModelIndex()) const override;
    [[nodiscard]] QModelIndex parent(const QModelIndex& child) const override;
    [[nodiscard]] int rowCount(const QModelIndex& parent = QModelIndex()) const override;
    [[nodiscard]] int columnCount(const QModelIndex& parent = QModelIndex()) const override;
    [[nodiscard]] QVariant data(const QModelIndex& index, int role = Qt::DisplayRole) const override;
    [[nodiscard]] Qt::ItemFlags flags(const QModelIndex& index) const override;
    [[nodiscard]] QHash<int, QByteArray> roleNames() const override;

    void setItems(const QList<ServerTreeItem>& items);
    void upsertItem(const ServerTreeItem& item);
    void removeItem(const QString& itemId);
    void clear();

    [[nodiscard]] ServerTreeItem itemForIndex(const QModelIndex& index) const;
    [[nodiscard]] QModelIndex indexForId(const QString& itemId) const;

private:
    struct Node {
        ServerTreeItem item;
        Node* parent = nullptr;
        std::vector<std::unique_ptr<Node>> children;
    };

    [[nodiscard]] Node* nodeForIndex(const QModelIndex& index) const;
    [[nodiscard]] int rowOfNode(const Node* node) const;
    [[nodiscard]] QIcon iconForNode(const Node& node) const;
    [[nodiscard]] QString decoratedName(const Node& node) const;
    void rebuild(const QList<ServerTreeItem>& items);
    void indexNode(Node* node);

    std::unique_ptr<Node> root_;
    QHash<QString, Node*> nodesById_;
};

}  // namespace baker::lite::ui
