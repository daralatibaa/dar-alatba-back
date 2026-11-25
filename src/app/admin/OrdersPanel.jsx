"use client";

import { useCallback, useEffect, useState } from "react";
import { SHIPPING_FEE } from "../lib/shipping";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "";

async function apiRequest(path, options) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...options?.headers
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || "تعذر إتمام الطلب، حاول مرة أخرى");
  }
  return payload;
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ar-EG", {
      dateStyle: "medium",
      timeStyle: "short"
    });
  } catch {
    return String(value);
  }
}

function paymentLabel(method) {
  if (method === "cod") return "الدفع عند الاستلام";
  if (method === "instapay") return "إنستاباي";
  if (method === "vodafone") return "فودافون كاش";
  return "تحويل";
}

function whatsappLabel(whatsapp) {
  const status =
    whatsapp.status === "sent"
      ? "تم إرسال رسالة التأكيد"
      : whatsapp.status === "failed"
        ? "تعذر إرسال الرسالة"
        : "لم تُرسل بعد";
  const reply =
    whatsapp.reply === "confirmed"
      ? "العميل أكّد الطلب"
      : whatsapp.reply === "cancelled"
        ? "العميل ألغى الطلب"
        : whatsapp.reply === "contact"
          ? "العميل طلب التواصل"
          : "";
  return reply ? `${status} — ${reply}` : status;
}

function shortId(id) {
  if (!id) return "—";
  return String(id).slice(-8).toUpperCase();
}

function OrderCard({ order, onComplete, onDelete, onPreview, completingId, deletingId }) {
  const productsTotal = Number(order.totalPrice || 0);
  const shipping = SHIPPING_FEE;
  const total = productsTotal + shipping;
  const deposit = 100;
  const remaining = Math.max(total - deposit, 0);
  const isCompleted = order.status === "completed";
  const isReceived = order.status === "received";
  const isCancelled = order.status === "cancelled";
  const receiptUrl = order.transferImage?.url;
  const isBusy = completingId === order._id || deletingId === order._id;

  return (
    <article className="order-admin-card border border-gray-200 rounded-xl overflow-hidden shadow-sm hover:border-[#c5a880]/40 transition duration-300">
      <div className="card-header bg-gray-50 p-4 border-b border-gray-100 flex flex-wrap gap-4 justify-between items-center">
        <div className="flex gap-3 items-center flex-wrap">
          <span className="font-sans font-bold text-gray-800 text-base">
            طلب: #{shortId(order._id)}
          </span>
          <span className="text-xs text-gray-500 font-sans">
            {formatDate(order.createdAt)}
          </span>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-bold font-sans ${
            isCompleted
              ? "text-emerald-700 bg-emerald-50"
              : isCancelled
                ? "text-red-700 bg-red-50"
                : isReceived
                  ? "text-sky-700 bg-sky-50"
                  : "text-amber-700 bg-amber-50"
          }`}
        >
          {isCompleted ? "مكتمل" : isCancelled ? "ملغي" : isReceived ? "تم التأكيد" : "قيد المراجعة"}
        </span>
      </div>

      <div className="card-body p-4 grid grid-cols-1 md:grid-cols-2 gap-6 text-sm font-sans">
        <div className="customer-info-side">
          <h4 className="font-bold text-[#0f3b2e] border-b border-gray-100 pb-1 mb-2">
            👤 بيانات العميل والشحن
          </h4>
          <ul className="space-y-1.5 text-gray-700">
            <li>
              <span className="text-gray-500">الاسم:</span> {order.customerName}
            </li>
            <li>
              <span className="text-gray-500">الهاتف:</span>{" "}
              <a
                href={`tel:${order.customerPhone}`}
                className="text-blue-600 font-semibold"
              >
                {order.customerPhone}
              </a>
            </li>
            <li>
              <span className="text-gray-500">المحافظة:</span> {order.governorate}
            </li>
            <li>
              <span className="text-gray-500">العنوان بالتفصيل:</span>{" "}
              {order.detailedAddress}
            </li>
            {order.notes && (
              <li>
                <span className="text-gray-500">ملاحظات:</span> {order.notes}
              </li>
            )}
            {order.whatsapp?.status && (
              <li>
                <span className="text-gray-500">واتساب:</span>{" "}
                {whatsappLabel(order.whatsapp)}
              </li>
            )}
          </ul>
        </div>

        <div className="payment-info-side">
          <h4 className="font-bold text-[#0f3b2e] border-b border-gray-100 pb-1 mb-2">
            💳 بيانات الدفع والتحويل
          </h4>
          <ul className="space-y-1.5 text-gray-700">
            <li>
              <span className="text-gray-500">طريقة الدفع:</span>{" "}
              <strong className="text-gray-800">{paymentLabel(order.paymentMethod)}</strong>
            </li>
            {order.paymentMethod !== "cod" && (
              <li>
                <span className="text-gray-500">رقم الهاتف الراسل:</span>{" "}
                <strong className="text-gray-800">{order.transferPhone || "—"}</strong>
              </li>
            )}
            <li>
              <span className="text-gray-500">إجمالي المنتجات:</span> {productsTotal} ج.م
            </li>
            <li>
              <span className="text-gray-500">الشحن:</span> {shipping} ج.م
            </li>
            <li>
              <span className="text-gray-500">إجمالي الفاتورة:</span> {total} ج.م
            </li>
            <li className="text-[#0f3b2e] font-bold">
              <span className="text-gray-500 font-normal">الدفعة المقدمة:</span>{" "}
              {deposit} ج.م
            </li>
            <li className="font-semibold">
              <span className="text-gray-500 font-normal">المتبقي عند الاستلام:</span>{" "}
              {remaining} ج.م
            </li>
            {isCompleted && order.completedAt && (
              <li>
                <span className="text-gray-500">تاريخ الإكمال:</span>{" "}
                {formatDate(order.completedAt)}
              </li>
            )}
          </ul>
        </div>
      </div>

      <div className="card-products-row p-4 bg-gray-50/50 border-t border-gray-100">
        <h4 className="font-sans font-bold text-[#0f3b2e] text-xs mb-2">
          📦 المنتجات المطلوبة:
        </h4>
        <div className="flex flex-wrap gap-3">
          {(order.items || []).map((item, index) => (
            <div
              key={`${order._id}-${item.product?._id || item.product || index}`}
              className="order-product-mini-tag bg-white border border-gray-200 px-3 py-1.5 rounded-lg flex items-center gap-2"
            >
              <img
                src={item.image || item.product?.images?.[0]?.url || "/images/logo.jpeg"}
                alt={item.name}
                className="w-6 h-8 object-cover rounded"
                onError={(event) => {
                  if (event.currentTarget.src.includes("/images/logo.jpeg")) return;
                  event.currentTarget.src = "/images/logo.jpeg";
                }}
              />
              <div className="text-[11px] font-sans">
                <span className="font-bold text-gray-800">{item.name}</span>
                <span className="text-gray-500 mr-2">x {item.quantity}</span>
                <span className="block text-emerald-800 font-semibold">
                  {item.price * item.quantity} ج.م
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card-actions-row p-4 border-t border-gray-100 flex flex-wrap gap-3 justify-between items-center bg-gray-50/20">
        <div>
          {receiptUrl ? (
            <button
              type="button"
              onClick={() => onPreview(receiptUrl)}
              className="view-receipt-action-btn"
            >
              🖼️ عرض صورة إيصال التحويل
            </button>
          ) : (
            <span className="text-xs text-gray-400">لا توجد صورة إيصال مرفقة</span>
          )}
        </div>

        <div className="order-card-action-buttons">
          {!isCompleted && !isCancelled && (
            <button
              type="button"
              onClick={() => onComplete(order)}
              disabled={isBusy}
              className="complete-order-btn"
            >
              {completingId === order._id ? "جاري الإكمال..." : "إكمال الطلب"}
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(order)}
            disabled={isBusy}
            className="delete-order-btn"
          >
            {deletingId === order._id ? "جاري الحذف..." : "حذف الطلب"}
          </button>
        </div>
      </div>
    </article>
  );
}

export default function OrdersPanel({ onCountChange }) {
  const [ordersTab, setOrdersTab] = useState("pending");
  const [pendingOrders, setPendingOrders] = useState([]);
  const [completedOrders, setCompletedOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [previewImage, setPreviewImage] = useState(null);
  const [completingId, setCompletingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const loadOrders = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [pendingResponse, completedResponse] = await Promise.all([
        apiRequest("/getAllOrders"),
        apiRequest("/getCompletedOrders")
      ]);
      const pending = pendingResponse.data || [];
      const completed = completedResponse.data || [];
      setPendingOrders(pending);
      setCompletedOrders(completed);
      onCountChange?.(pending.length);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    void Promise.resolve().then(loadOrders);
  }, [loadOrders]);

  const showNotice = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  };

  const handleComplete = async (order) => {
    if (
      !window.confirm(
        `هل تريد إكمال الطلب #${shortId(order._id)}؟ سيتم نقله إلى الطلبات المكتملة.`
      )
    ) {
      return;
    }

    setCompletingId(order._id);
    setError("");
    try {
      await apiRequest(`/completeOrder/${order._id}`, { method: "PUT" });
      await loadOrders();
      setOrdersTab("completed");
      showNotice("تم إكمال الطلب بنجاح");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setCompletingId(null);
    }
  };

  const handleDelete = async (order) => {
    if (
      !window.confirm(
        `هل أنت متأكد من حذف الطلب #${shortId(order._id)} نهائياً من قاعدة البيانات؟ لا يمكن التراجع عن هذا الإجراء.`
      )
    ) {
      return;
    }

    setDeletingId(order._id);
    setError("");
    try {
      await apiRequest(`/deleteOrder/${order._id}`, { method: "DELETE" });
      await loadOrders();
      showNotice("تم حذف الطلب نهائياً من قاعدة البيانات");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDeletingId(null);
    }
  };

  const visibleOrders =
    ordersTab === "pending" ? pendingOrders : completedOrders;

  return (
    <section className="orders-management-panel">
      <div className="panel-header mb-6 border-b border-gray-100 pb-4 flex flex-wrap gap-4 justify-between items-center">
        <div>
          <h2 className="font-serif text-2xl font-bold text-[#0f3b2e] m-0">
            طلبيات العملاء
          </h2>
          <p className="categories-subtitle">
            الطلبات المعلقة تُكتمل أو تُحذف من هنا، ويمكن حذف أي طلب نهائياً من قاعدة البيانات
          </p>
        </div>
        <button type="button" onClick={loadOrders} className="add-new-prod-btn font-sans">
          تحديث الطلبات
        </button>
      </div>

      <div className="orders-tabs-bar mb-5">
        <button
          type="button"
          className={`orders-tab-btn ${ordersTab === "pending" ? "active" : ""}`}
          onClick={() => setOrdersTab("pending")}
        >
          قيد المراجعة
          <span>{pendingOrders.length}</span>
        </button>
        <button
          type="button"
          className={`orders-tab-btn ${ordersTab === "completed" ? "active" : ""}`}
          onClick={() => setOrdersTab("completed")}
        >
          مكتملة
          <span>{completedOrders.length}</span>
        </button>
      </div>

      {notice && <div className="admin-success-message">{notice}</div>}
      {error && (
        <div className="admin-error-message">
          <span>{error}</span>
          <button type="button" onClick={loadOrders}>
            إعادة المحاولة
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="categories-loading">
          <div className="spinner-loader" />
          <span>جاري تحميل الطلبات...</span>
        </div>
      ) : visibleOrders.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <svg
            className="w-16 h-16 mx-auto mb-4 opacity-50"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2"
            />
          </svg>
          <h3>
            {ordersTab === "pending"
              ? "لا توجد طلبيات قيد المراجعة حالياً"
              : "لا توجد طلبيات مكتملة حالياً"}
          </h3>
          <p className="text-xs">
            {ordersTab === "pending"
              ? "بمجرد إتمام العميل للطلب من صفحة الدفع، سيظهر هنا فوراً."
              : "الطلبات المكتملة ستظهر هنا بعد الضغط على «إكمال الطلب»."}
          </p>
        </div>
      ) : (
        <div className="orders-cards-list space-y-6">
          {visibleOrders.map((order) => (
            <OrderCard
              key={order._id}
              order={order}
              onComplete={handleComplete}
              onDelete={handleDelete}
              onPreview={setPreviewImage}
              completingId={completingId}
              deletingId={deletingId}
            />
          ))}
        </div>
      )}

      {previewImage && (
        <div
          className="admin-login-modal-overlay"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative bg-white p-4 rounded-2xl max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col items-center shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className="flex justify-between items-center w-full border-b border-gray-100 pb-2 mb-4 text-right"
              dir="rtl"
            >
              <h3 className="font-serif text-lg font-bold text-gray-800 m-0">
                صورة إيصال التحويل المرفق
              </h3>
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="close-modal-x-btn"
              >
                ✕
              </button>
            </div>
            <div
              className="w-full flex justify-center items-center overflow-auto"
              style={{ maxHeight: "65vh" }}
            >
              <img
                src={previewImage}
                alt="إيصال التحويل"
                className="max-w-full h-auto object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
