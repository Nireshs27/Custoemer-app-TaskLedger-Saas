import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Receipt, Car, ServerCog } from "lucide-react";
import PropertyForm from "@/components/forms/property-form";
import VehicleForm from "@/components/forms/vehicle-form";
import AssetForm from "@/components/forms/asset-form";

interface AddNewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ItemType = 'vehicle' | 'asset' | 'property' | null;

export default function AddNewModal({ isOpen, onClose }: AddNewModalProps) {
  const [selectedType, setSelectedType] = useState<ItemType>(null);

  const handleClose = () => {
    setSelectedType(null);
    onClose();
  };

  const handleBack = () => {
    setSelectedType(null);
  };

  const items = [
    {
      id: 'vehicle',
      label: 'Vehicle',
      icon: Car,
      color: 'chart-3',
      description: 'Insurance, registration, PUC certificates'
    },
    {
      id: 'asset',
      label: 'Asset/Machinery',
      icon: ServerCog,
      color: 'chart-4',
      description: 'Service dates, maintenance, warranties'
    },
  ];

  const renderForm = () => {
    switch (selectedType) {
      case 'vehicle':
        return <VehicleForm onSuccess={handleClose} onCancel={handleBack} />;
      case 'asset':
        return <AssetForm onSuccess={handleClose} onCancel={handleBack} />;
      case 'property':
        return <PropertyForm onSuccess={handleClose} onCancel={handleBack} />;
      default:
        return null;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl" data-testid="modal-add-new">
        <DialogHeader>
          <DialogTitle>
            {selectedType ? `Add New ${selectedType === 'vehicle' ? 'Vehicle Item' : selectedType === 'asset' ? 'Asset Item' : 'Property'}` : 'Add New Item'}
          </DialogTitle>
        </DialogHeader>
        
        {selectedType ? (
          <div className="mt-4">
            {renderForm()}
          </div>
        ) : (
          <div className="mt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    key={item.id}
                    variant="outline"
                    onClick={() => setSelectedType(item.id as ItemType)}
                    className={`p-6 h-auto justify-start space-x-4 hover:border-${item.color} hover:bg-${item.color}/5 transition-colors group`}
                    data-testid={`select-type-${item.id}`}
                  >
                    <div className={`w-12 h-12 bg-${item.color}/10 rounded-lg flex items-center justify-center group-hover:bg-${item.color}/20`}>
                      <Icon className={`w-6 h-6 text-${item.color}`} />
                    </div>
                    <div className="text-left">
                      <h3 className="font-medium text-foreground">{item.label}</h3>
                      <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
                    </div>
                  </Button>
                );
              })}
              
              {/* Add Property option */}
              <Button
                variant="outline"
                onClick={() => setSelectedType('property')}
                className="p-6 h-auto justify-start space-x-4 hover:border-chart-5 hover:bg-chart-5/5 transition-colors group"
                data-testid="select-type-property"
              >
                <div className="w-12 h-12 bg-chart-5/10 rounded-lg flex items-center justify-center group-hover:bg-chart-5/20">
                  <Receipt className="w-6 h-6 text-chart-5" />
                </div>
                <div className="text-left">
                  <h3 className="font-medium text-foreground">Property</h3>
                  <p className="text-xs text-muted-foreground mt-1">Add a new property for tax tracking</p>
                </div>
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
